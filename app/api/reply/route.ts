import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from 'redis';
import { upsertGoogleCalendarEvent } from '../cron/calendar-helper';

function encodeSubject(subject: string): string {
  if (subject.startsWith('=?UTF-8?')) return subject;
  const base64Str = Buffer.from(subject, 'utf-8').toString('base64');
  return `=?UTF-8?B?${base64Str}?=`;
}

export async function POST(req: NextRequest) {
  const redisClient = createClient({ url: process.env.REDIS_URL });

  try {
    // 💡 1. 프론트엔드에서 넘어오는 actionType을 함께 구조 분해 할당합니다.
    const body = await req.json();
    const { threadId, replyText, eventDetails, actionType } = body;

    console.log("==========================================");
    console.log("📨 프론트엔드에서 넘어온 Raw 페이로드 확인:");
    console.log(`- threadId: ${threadId}`);
    console.log(`- actionType: ${actionType || 'reply (기본값)'}`);
    console.log(`- replyText: ${replyText?.substring(0, 20)}...`);
    console.log(`- eventDetails 존재 여부: ${!!eventDetails}`);
    console.log("==========================================");

    // 💡 2. 유효성 검사 수정: actionType이 'archive'일 때는 replyText 검증을 우회(패스)합니다.
    if (!threadId || (actionType !== 'archive' && !replyText)) {
      return NextResponse.json(
        { success: false, error: 'threadId와 replyText는 필수입니다.' }, 
        { status: 400 }
      );
    }

    // ==================================================================
    // 📦 [처리 분기 1] 이 일정 건너뛰기 (보관 처리)인 경우
    // ==================================================================
    if (actionType === 'archive') {
      await redisClient.connect();
      
      const redisKey = `pending_meeting:${threadId}`;
      
      // 🟢 [수정] DB에서 완전히 삭제하지 않고, status 필드만 'ARCHIVED'로 변경합니다.
      await redisClient.hSet(redisKey, 'status', 'ARCHIVED');
      console.log(`📦 [보관 완료] Redis 키 ${redisKey}의 상태를 ARCHIVED로 변경했습니다.`);

      await redisClient.quit();
      
      return NextResponse.json({ 
        success: true, 
        message: '일정을 대시보드에서 제외하고 안전하게 보관 처리했습니다.' 
      });
    }

    // ==================================================================
    // ✉️ [처리 분기 2] 이메일 답장 발송 및 캘린더 등록 (기존 로직 유지)
    // ==================================================================
    
    // 1. Google OAuth2 클라이언트 세팅
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: process.env.HUSBAND_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 2. 원본 스레드 메일 정보 파악
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId });
    const messages = thread.data.messages || [];
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      return NextResponse.json({ success: false, error: '원본 메시지를 찾을 수 없습니다.' }, { status: 404 });
    }

    const headers = lastMessage.payload?.headers;
    const from = headers?.find(h => h.name?.toLowerCase() === 'from')?.value || '';
    const subject = headers?.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
    const messageId = headers?.find(h => h.name?.toLowerCase() === 'message-id')?.value || '';

    // 3. RFC 2822 표준 이메일 포맷 작성
    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
    const encodedSubject = encodeSubject(replySubject);

    const mailLines = [
      `To: ${from}`,
      `Subject: ${encodedSubject}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      `Content-Type: text/plain; charset=utf-8`,
      `MIME-Version: 1.0`,
      '',
      replyText
    ];
    const mailContent = mailLines.join('\r\n');

    const encodedMail = Buffer.from(mailContent)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 4. 지메일 API로 답장 전송 실행
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMail,
        threadId: threadId
      }
    });

    // 5. 공통 헬퍼를 이용한 구글 캘린더 동적 등록 및 Redis 클리어
    if (eventDetails && eventDetails.estimated_start) {
      await redisClient.connect();

      // 1) 동적 카테고리 색상 추출을 위해 Redis에서 남편 프로필 획득
      const profileKey = 'user_profile:husband';
      const userProfileRaw = await redisClient.get(profileKey);
      const profile = userProfileRaw ? JSON.parse(userProfileRaw) : { defaultTimezone: "America/New_York", calendarCategories: {} };

      // 2) 묶어둔 공통 캘린더 헬퍼 호출
      await upsertGoogleCalendarEvent(oauth2Client, profile, {
        title: eventDetails.title,
        start_iso: eventDetails.estimated_start,
        duration: eventDetails.duration || "1h",
        location: eventDetails.location || "",
        calendar_type: eventDetails.calendar_type || "INDIV",
        description: `[자동 확정] 대시보드 확답 회신을 통해 확정된 일정입니다.\n\n${eventDetails.description || ''}`,
        meeting_timezone: eventDetails.meeting_timezone || profile.defaultTimezone
      });

      console.log(`✨ [캘린더 연동 완료] ${eventDetails.title} 일정이 구글 캘린더에 성공적으로 등록되었습니다.`);

      const redisKey = `pending_meeting:${threadId}`;
      const deleteResult = await redisClient.del(redisKey);
      console.log(`🗑️ [디버깅] Redis 삭제 키: ${redisKey} | 결과(1이면 성공): ${deleteResult}`);

      await redisClient.quit();
    }

    return NextResponse.json({ success: true, message: '답장 전송 및 캘린더 등록이 성공적으로 완료되었습니다.' });

  } catch (error: any) {
    // 에러 핸들링 단계에서 안전하게 Redis 커넥션 닫기
    try { 
      if (redisClient.isOpen) {
        await redisClient.disconnect(); 
      }
    } catch (e) { }
    
    console.error('❌ 지메일 답장 및 캘린더 연동 실패:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}