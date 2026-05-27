import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from 'redis';
import { cleanEmailBody, extractText } from './utils';
import { askOpenAIToParse } from './openai-helper';
import { upsertGoogleCalendarEvent } from './calendar-helper';

interface DebugResult { subject: string; status: string; }

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.HUSBAND_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });

  try {
    await redisClient.connect();

    // [STEP 0] 프로필 로드 및 카테고리 동적 구성
    const profileKey = 'user_profile:husband';
    const userProfileRaw = await redisClient.get(profileKey);
    const profile = userProfileRaw ? JSON.parse(userProfileRaw) : { defaultTimezone: "America/New_York", calendarCategories: {} };

    const availableCategories = Object.keys(profile.calendarCategories || {}).length > 0
      ? Object.keys(profile.calendarCategories)
      : ["CHURCH", "PSYCH", "INDIV"];

    const gmailRes = await gmail.users.messages.list({ userId: 'me', q: 'label:To-AI', maxResults: 20 });
    const messages = gmailRes.data.messages || [];
    if (messages.length === 0) {
      await redisClient.disconnect();
      return NextResponse.json({ message: "No emails found." });
    }

    const labelsRes = await gmail.users.labels.list({ userId: 'me' });
    const aiLabelId = labelsRes.data.labels?.find(l => l.name === 'To-AI')?.id || "";

    const debugResults: DebugResult[] = [];
    const processedThreadIds = new Set<string>();

    for (const msg of messages) {
      const threadId = msg.threadId;
      if (!threadId || processedThreadIds.has(threadId)) continue;
      processedThreadIds.add(threadId);

      const threadData = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
      const threadMessages = threadData.data.messages || [];
      const emailSubject = threadMessages[0]?.payload?.headers?.find(h => h.name?.toLowerCase() === 'subject')?.value || 'No Subject';

      let threadHistory = "";
      threadMessages.forEach((m, index) => {
        let fullBody = extractText(m.payload);
        if (!fullBody && m.payload?.body?.data) {
          fullBody = Buffer.from(m.payload.body.data, 'base64').toString('utf8');
        }
        threadHistory += `[Reply #${index + 1}]\n- From: ${m.payload?.headers?.find(h => h.name?.toLowerCase() === 'from')?.value}\n- Content: ${cleanEmailBody(fullBody || m.snippet || "")}\n-----------\n`;
      });

      // [STEP 1] 시간 앵커 주입
      const targetTimezone = profile.defaultTimezone || 'America/New_York';
      const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: profile.defaultTimezone });
      const englishWeekday = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: targetTimezone });
      const emailFullBody = `[System Time Anchor]
- Current Date: ${ymd}
- Current Weekday: ${englishWeekday}
- Reference Context: Use this anchor as "Today" for all relative time tokens like "next Tuesday", "tomorrow" (내일), or "this Friday".

Subject: ${emailSubject}

[Full Conversation History]
${threadHistory}`;

      // 🔥 디버깅용 로그 추가: AI에게 실제로 날짜가 어떻게 넘어가는지 콘솔에서 눈으로 확인
      console.log(`🤖 AI 주입 앵커 검증 -> 날짜: ${ymd} / 요일: ${englishWeekday}`);

      // [STEP 2] 외부 OpenAI 헬퍼 호출
      const aiResponse = await askOpenAIToParse(emailFullBody, profile, availableCategories);
      const rawContent = aiResponse.choices[0].message.content || '{}';
      const eventData = JSON.parse(aiResponse.choices[0].message.content || '{}');

      console.log("==================================================");
      console.log("🔍 OpenAI가 실제로 반환한 RAW JSON 데이터:");
      console.log(rawContent);
      console.log(`📌 코드 내 실제 평가 값 -> has_schedule: ${eventData.has_schedule} (타입: ${typeof eventData.has_schedule}), is_negotiating: ${eventData.is_negotiating} (타입: ${typeof eventData.is_negotiating})`);
      console.log("==================================================");

      // [STEP 3] 분기 처리 및 구글 캘린더/Redis 적재
      if (eventData.has_schedule) {
        await upsertGoogleCalendarEvent(oauth2Client, profile, eventData);
        debugResults.push({ subject: emailSubject, status: "캘린더 즉시 등록 완료" });

      } else if (eventData.is_negotiating) {
        await redisClient.set(`pending_meeting:${threadId}`, JSON.stringify({
          threadId, subject: emailSubject, title: eventData.title, proposed_dates: eventData.proposed_dates,
          suggested_reply: eventData.suggested_reply, calendar_type: eventData.calendar_type, duration: eventData.duration,
          location: eventData.location, estimated_start: eventData.start_iso
        }));
        debugResults.push({ subject: emailSubject, status: "대시보드 보관함(Redis) 이동" });
      } else {
        debugResults.push({ subject: emailSubject, status: "스케줄 관련 없음 패스" });
      }

      // 라벨 제거
      if (aiLabelId) {
        await gmail.users.threads.modify({ userId: 'me', id: threadId, requestBody: { removeLabelIds: [aiLabelId] } });
      }
    }

    await redisClient.disconnect();
    return NextResponse.json({ success: true, processed_count: processedThreadIds.size, details: debugResults });

  } catch (error: any) {
    try { await redisClient.disconnect(); } catch (e) { }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}