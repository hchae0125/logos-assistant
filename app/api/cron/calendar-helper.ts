import { google } from 'googleapis';

export interface CalendarEventPayload {
  title: string;
  start_iso: string;
  duration: string;
  location: string;
  calendar_type: string;
  description?: string;
  meeting_timezone?: string;
}

/**
 * 📅 구글 캘린더 중복 체크 후 일정을 동적으로 등록하는 공通 마스터 함수
 */
export async function upsertGoogleCalendarEvent(
  oauth2Client: any,
  profile: any,
  eventData: CalendarEventPayload
) {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // 1️⃣ Redis 프로필 기반으로 카테고리 색상 인덱스 동적 연산
  const availableCategories = Object.keys(profile.calendarCategories || {});
  const categoryIndex = availableCategories.indexOf(eventData.calendar_type);
  const colorId = categoryIndex !== -1 ? String(categoryIndex + 1) : '1';

  // 2️⃣ 종료 시간 계산 (기본 1시간 세팅)
  const hours = parseInt(eventData.duration?.match(/(\d+)h/)?.[1] || "1", 10);
  const startDateTime = new Date(eventData.start_iso);
  const endDateTime = new Date(startDateTime.getTime() + hours * 60 * 60 * 1000);

  // 3️⃣ 중복 일정 검증 (앞뒤 2시간 버퍼)
  const existingEvents = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date(startDateTime.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(endDateTime.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    q: eventData.title,
  });

  // 4️⃣ 발견된 중복/이전 일정 깔끔하게 삭제
  for (const oldEvent of existingEvents.data.items || []) {
    if (oldEvent.id) {
      console.log(`🗑️ [캘린더 헬퍼] 중복 일정 발견 및 삭제: ${oldEvent.summary}`);
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: oldEvent.id
      });
    }
  }

  // 5️⃣ ISO 포맷 정제 및 타임존 결정
  const pureStartIso = eventData.start_iso.split('.')[0].substring(0, 19);
  const pureEndIso = endDateTime.toISOString().split('.')[0].substring(0, 19);
  const finalTimeZone = eventData.meeting_timezone || profile.defaultTimezone || 'America/New_York';

  // 6️⃣ 최종 구글 캘린더 인서트
  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: eventData.title,
      location: eventData.location,
      description: eventData.description || '',
      colorId: colorId,
      start: { dateTime: pureStartIso, timeZone: finalTimeZone },
      end: { dateTime: pureEndIso, timeZone: finalTimeZone },
    },
  });

  return response.data;
}