import { NextResponse } from 'next/server';
import { createClient } from 'redis';
import { google } from 'googleapis';
import { PendingMeeting } from '../../types';

// 1. Google Calendar API 클라이언트 초기화 함수
function getGoogleCalendarClient() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/^"(.*)"$/, '$1')
    : undefined;

  if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey) {
    throw new Error('구글 서비스 계정 환경변수(EMAIL 또는 KEY)가 세팅되지 않았습니다.');
  }

  // 🎯 위치 순서 대신 객체 매핑 매개변수를 사용하여 셋팅 (TypeScript 빨간줄 원천 차단)
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly']
  });

  return google.calendar({ version: 'v3', auth });
}

// 2. 대체 시간대 제안 보조 함수 (충돌 시 2시간 뒤를 임시 제안)
function generateAlternativeSuggestion(isoStartStr: string): string {
  const date = new Date(isoStartStr);
  date.setHours(date.getHours() + 2);
  
  return date.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }) + " 가능";
}

// 3. 메인 GET 핸들러
export async function GET() {
  // Redis 클라이언트 초기화
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    // 💡 Redis 및 Google Calendar API 병렬 준비 단계 진입
    await redisClient.connect();

    // 'pending_meeting:*' 패턴에 일치하는 모든 키 조회
    const keys = await redisClient.keys('pending_meeting:*');
    const rawMeetings: PendingMeeting[] = [];
    
    // 루프를 돌며 Redis에서 JSON 데이터를 파싱하여 리스트업
    for (const key of keys) {
      const rawData = await redisClient.get(key);
      if (rawData) {
        try {
          rawMeetings.push(JSON.parse(rawData) as PendingMeeting);
        } catch (parseErr) {
          console.error(`JSON Parsing Error for key ${key}:`, parseErr);
        }
      }
    }
    
    // 비즈니스 로직 처리를 위해 Redis 연결 조기 해제 (커넥션 자원 반환)
    await redisClient.disconnect();

    // 분석할 대기 중인 일정이 없거나, 시간 데이터가 없으면 그대로 반환
    const targetMeetings = rawMeetings.filter(m => m.status !== 'ARCHIVED' && m.estimated_start);
    if (targetMeetings.length === 0) {
      return NextResponse.json({ success: true, data: rawMeetings }, { status: 200 });
    }

    // 💡 Google Calendar FreeBusy API 최적화 쿼리 구간
    const calendar = getGoogleCalendarClient();
    const startTimes = targetMeetings.map(m => new Date(m.estimated_start!).getTime());
    
    // 전체 미팅 카드의 타임라인 범위를 계산하여 캘린더 단 1회만 조회 (Batching)
    const minTime = new Date(Math.min(...startTimes)).toISOString();
    const maxTime = new Date(Math.max(...startTimes) + 4 * 60 * 60 * 1000).toISOString(); // 최대 범위에 4시간 마진 부여

    const fbResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: minTime,
        timeMax: maxTime,
        items: [{ id: 'primary' }]
      }
    });

    const busySlots = fbResponse.data.calendars?.primary?.busy || [];

    // 💡 캘린더 바쁜 시간대와 Redis 데이터를 매핑 및 가공
    const enrichedMeetings: PendingMeeting[] = rawMeetings.map(meeting => {
      if (!meeting.estimated_start || meeting.status === 'ARCHIVED') return meeting;

      const meetingStart = new Date(meeting.estimated_start).getTime();
      const durationHours = meeting.duration?.includes('h') ? parseFloat(meeting.duration) : 1;
      const meetingEnd = meetingStart + (durationHours * 60 * 60 * 1000);

      // 내 캘린더의 바쁜 슬롯(busySlots) 중 시간대가 오버랩되는 일정이 있는지 검증
      const conflictingSlot = busySlots.find(slot => {
        const busyStart = new Date(slot.start!).getTime();
        const busyEnd = new Date(slot.end!).getTime();
        return meetingStart < busyEnd && meetingEnd > busyStart;
      });

      if (conflictingSlot) {
        return {
          ...meeting,
          calendar_status: {
            has_conflict: true,
            conflicting_event_title: "기존 고정 일정", // FreeBusy API 보안 특성상 제목은 비공개 처리됨
            alternative_suggestion: generateAlternativeSuggestion(meeting.estimated_start)
          }
        };
      }

      return {
        ...meeting,
        calendar_status: {
          has_conflict: false
        }
      };
    });

    return NextResponse.json({ success: true, data: enrichedMeetings }, { status: 200 });
    
  } catch (error: any) {
    console.error("Redis & Calendar Integration Fetch Error:", error);
    
    // 에러 발생 시 커넥션 유실을 방지하기 위한 안전 대책 익명 해제 처리
    try { 
      if (redisClient.isOpen) {
        await redisClient.disconnect(); 
      }
    } catch (e) {}
    
    return NextResponse.json(
      { success: false, error: error.message || '서버 내부 오류가 발생했습니다.' }, 
      { status: 500 }
    );
  }
}