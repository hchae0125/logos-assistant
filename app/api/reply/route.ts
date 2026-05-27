import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from 'redis'; // 👈 Redis 클라이언트 추가
import { upsertGoogleCalendarEvent } from '../cron/calendar-helper';

function encodeSubject(subject: string): string {
  if (subject.startsWith('=?UTF-8?')) return subject;
  const base64Str = Buffer.from(subject, 'utf-8').toString('base64');
  return `=?UTF-8?B?${base64Str}?=`;
}

export async function POST(req: NextRequest) {
  const redisClient = createClient({ url: process.env.REDIS_URL }); // 👈 Redis 선언

  try {
    // 💡 프론트엔드에서 eventDetails(일정 메타데이터)도 함께 받아오도록 필드 추가
    const { threadId, replyText, eventDetails } = await req.json();

    console.log("==========================================");
    console.log("📨 프론트엔드에서 넘어온 Raw 페이로드 확인:");
    console.log(`- threadId: ${threadId}`);
    console.log(`- replyText: ${replyText?.substring(0, 20)}...`);
    console.log(`- eventDetails 존재 여부: ${!!eventDetails}`);
    if (eventDetails) {
      console.log(`- eventDetails 데이터 세부항목:`, JSON.stringify(eventDetails));
    }
    console.log("==========================================");

    if (!threadId || !replyText) {
      return NextResponse.json({ success: false, error: 'threadId와 replyText는 필수입니다.' }, { status: 400 });
    }

    // 1. Google OAuth2 클라이언트 세팅 (기존 유지)
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: process.env.HUSBAND_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 2. 원본 스레드 메일 정보 파악 (기존 유지)
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

    // 3. RFC 2822 표준 이메일 포맷 작성 (기존 유지)
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

    // 4. 지메일 API로 답장 전송 실행 (기존 유지)
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMail,
        threadId: threadId
      }
    });


    // ==================================================================
    // 📅 [🔥 새롭게 추가된 파이프라인] 공통 헬퍼를 이용한 구글 캘린더 동적 등록
    // ==================================================================
    if (eventDetails && eventDetails.estimated_start) {
      await redisClient.connect();

      // 1) 동적 카테고리 색상 추출을 위해 Redis에서 남편 프로필 획득
      const profileKey = 'user_profile:husband';
      const userProfileRaw = await redisClient.get(profileKey);
      const profile = userProfileRaw ? JSON.parse(userProfileRaw) : { defaultTimezone: "America/New_York", calendarCategories: {} };

      // 2) 묶어둔 공통 캘린더 헬퍼 호출 (타입 변환 및 중복 제거 자동 수행)
      await upsertGoogleCalendarEvent(oauth2Client, profile, {
        title: eventDetails.title,
        start_iso: eventDetails.estimated_start, // 대시보드 펜딩 날짜 매핑
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

      // 🔥 취소선 에러 해결: disconnect() 대신 quit() 사용
      await redisClient.quit();
    }
    // ==================================================================

    return NextResponse.json({ success: true, message: '답장 전송 및 캘린더 등록이 성공적으로 완료되었습니다.' });

  } catch (error: any) {
    try { await redisClient.disconnect(); } catch (e) { }
    console.error('❌ 지메일 답장 및 캘린더 연동 실패:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}