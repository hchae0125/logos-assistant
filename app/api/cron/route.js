import { google } from 'googleapis';
import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv'; // 👈 Vercel KV 가져오기

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.HUSBAND_REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

export async function GET() {
  try {
    const gmailRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'label:To-AI',
      maxResults: 20,
    });

    const messages = gmailRes.data.messages || [];
    if (messages.length === 0) {
      return NextResponse.json({ message: "No emails found with 'To-AI' label." });
    }

    const labelsRes = await gmail.users.labels.list({ userId: 'me' });
    const aiLabel = labelsRes.data.labels.find(l => l.name === 'To-AI');
    if (!aiLabel) return NextResponse.json({ message: "Label 'To-AI' not found." }, { status: 400 });
    const aiLabelId = aiLabel.id;

    let debugResults = [];
    const processedThreadIds = new Set();

    for (const msg of messages) {
      const threadId = msg.threadId;
      if (processedThreadIds.has(threadId)) continue;
      processedThreadIds.add(threadId);

      const threadData = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
      const threadMessages = threadData.data.messages || [];
      const emailSubject = threadMessages[0].data?.payload?.headers?.find(h => h.name === 'Subject')?.value || 'No Subject';
      
      let threadHistory = "";
      threadMessages.forEach((m, index) => {
        threadHistory += `[Reply #${index + 1}]\nContent: ${m.snippet}\n\n`;
      });

      const emailFullBody = `Subject: ${emailSubject}\n\n[Full Conversation History]\n${threadHistory}`;

      // OpenAI 구조화된 데이터 추출 가이드 강화
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an executive AI assistant. Your task is to analyze the email thread history and determine if there is a CONFIRMED schedule or a TENTATIVE schedule proposal still being negotiated.
            Current year is 2026.
            
            [Rules]
            1. Set "has_schedule" to true ONLY if the final exchange shows a 100% mutually agreed, fixed meeting.
            2. Set "is_negotiating" to true if the final status is NOT confirmed yet, but the sender or user is PROPOSING options, asking for availability, or trying to schedule something. If it's just spam or order confirmations, set it to false.
            3. "proposed_dates": Briefly summarize the suggested options (e.g., "Next Tuesday or Wednesday afternoon").
            4. "suggested_reply": Draft a professional English reply assuming the user wants to accept the first viable option or ask to confirm.`
          },
          { role: "user", content: emailFullBody }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "calendar_event",
            schema: {
              type: "object",
              properties: {
                has_schedule: { type: "boolean" },
                is_negotiating: { type: "boolean", description: "True if they are still negotiating or proposing meeting dates." },
                title: { type: "string" },
                start_datetime: { type: "string", description: "Start date time (YYYYMMDDTHHMM) if confirmed or best estimated guess from proposals." },
                duration: { type: "string" },
                location: { type: "string" },
                calendar_type: { type: "string", enum: ["CHURCH", "PSYCH", "STUDY"] },
                proposed_dates: { type: "string" },
                suggested_reply: { type: "string" },
                description: { type: "string" }
              },
              required: ["has_schedule", "is_negotiating", "title", "start_datetime", "duration", "location", "calendar_type", "proposed_dates", "suggested_reply", "description"]
            }
          }
        }
      });

      const eventData = JSON.parse(aiResponse.choices[0].message.content);

      // 확정된 일정이면 기존처럼 구글 캘린더에 바로 삽입
      if (eventData.has_schedule) {
        let colorId = '1'; 
        if (eventData.calendar_type === 'PSYCH') colorId = '3';
        if (eventData.calendar_type === 'STUDY') colorId = '2';

        const matchedDuration = eventData.duration.match(/(\d+)h/);
        const hours = matchedDuration ? parseInt(matchedDuration[1]) : 1;
        
        const year = eventData.start_datetime.substring(0, 4);
        const month = eventData.start_datetime.substring(4, 6);
        const day = eventData.start_datetime.substring(6, 8);
        const hour = eventData.start_datetime.substring(9, 11);
        const minute = eventData.start_datetime.substring(11, 13);
        
        const startIso = `${year}-${month}-${day}T${hour}:${minute}:00`;
        const endIso = `${year}-${month}-${day}T${String(parseInt(hour) + hours).padStart(2, '0')}:${minute}:00`;

        await calendar.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: eventData.title,
            location: eventData.location,
            description: eventData.description,
            colorId: colorId,
            start: { dateTime: startIso, timeZone: 'America/New_York' },
            end: { dateTime: endIso, timeZone: 'America/New_York' },
          },
        });

        debugResults.push({ subject: emailSubject, status: "캘린더 즉시 등록 완료" });

      } else if (eventData.is_negotiating) {
        // ⭐ [핵심 추가] 컨펌 대기 중인 일정이면 Vercel KV에 임시 보관!
        // 중복 방지를 위해 threadId를 Key로 사용해서 데이터를 객체로 저장해.
        await kv.hset(`pending_meeting:${threadId}`, {
          threadId: threadId,
          subject: emailSubject,
          title: eventData.title,
          proposed_dates: eventData.proposed_dates,
          suggested_reply: eventData.suggested_reply,
          calendar_type: eventData.calendar_type,
          duration: eventData.duration,
          location: eventData.location,
          estimated_start: eventData.start_datetime
        });

        debugResults.push({ subject: emailSubject, status: "대시보드 보관함(Vercel KV)으로 이동" });
      } else {
        debugResults.push({ subject: emailSubject, status: "스케줄 관련 없음 - 패스" });
      }

      // 처리가 끝나면 스레드에서 To-AI 라벨 제거
      try {
        await gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: { removeLabelIds: [aiLabelId] },
        });
      } catch (e) {
        console.error("라벨 제거 실패:", e.message);
      }
    }

    return NextResponse.json({ success: true, processed_count: processedThreadIds.size, details: debugResults });

  } catch (error) {
    console.error("Automation Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}