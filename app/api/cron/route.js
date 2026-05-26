import { google } from 'googleapis';
import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';
import { createClient } from 'redis'

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

    const redisClient = createClient({ url: process.env.REDIS_URL });
    try {
        await redisClient.connect();
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

            // 🎯 [제목 추출 로직 완벽 보정] 
            // headers가 담긴 payload를 안전하게 체이닝하고, 대소문자 구분 없이 Subject를 찾습니다.
            const firstMessagePayload = threadMessages[0]?.payload;
            const emailSubject = firstMessagePayload?.headers?.find(
                h => h.name.toLowerCase() === 'subject'
            )?.value || '실제 제목 없음 (No Subject)';

            let threadHistory = "";
            threadMessages.forEach((m, index) => {
                let fullBody = "";

                // 🎯 [정확한 경로 설정] m.data.payload가 아니라 m.payload가 맞습니다!
                const payload = m.payload;

                // 지메일 본문 텍스트를 재귀적으로 샅샅이 뒤져서 찾아내는 헬퍼 함수
                function extractText(part) {
                    if (!part) return "";

                    // 1. 현재 파트가 텍스트(plain) 형태라면 바로 디코딩
                    if (part.mimeType === 'text/plain' && part.body?.data) {
                        return Buffer.from(part.body.data, 'base64').toString('utf8');
                    }

                    // 2. 하위 파트(parts)가 더 있다면 재귀적으로 탐색
                    if (part.parts && part.parts.length > 0) {
                        let accumulatedText = "";
                        for (const subPart of part.parts) {
                            accumulatedText += extractText(subPart);
                        }
                        return accumulatedText;
                    }

                    return "";
                }

                // 먼저 정석대로 텍스트 추출 시도
                if (payload) {
                    fullBody = extractText(payload);

                    // 만약 구조가 단일 본문 형태로만 되어 있는 경우 예외 처리
                    if (!fullBody && payload.body?.data) {
                        fullBody = Buffer.from(payload.body.data, 'base64').toString('utf8');
                    }
                }

                // 🚨 최종 안전장치: 그래도 본문이 안 뽑혔다면 snippet이라도 쓰되, 
                // 텍스트가 잘 뽑혔다면 완벽한 전체 본문이 들어갑니다!
                if (!fullBody || fullBody.trim() === "") {
                    fullBody = m.snippet || "No Content";
                }

                threadHistory += `[Reply #${index + 1}]\nContent: ${fullBody}\n\n`;
            });

            const emailFullBody = `Subject: ${emailSubject}\n\n[Full Conversation History]\n${threadHistory}`;

            // 🚨 [초강력 디버깅 덤프 로그] 
            // OpenAI한테 가기 전에 내 눈으로 "진짜 메일 내용"과 "추출된 제목"을 검증하는 로그입니다.
            console.log("\n==================================================================");
            console.log(`📨 [검거된 메일 제목]: ${emailSubject}`);
            console.log(`🆔 [스레드 ID]: ${threadId}`);
            console.log("------------------------------------------------------------------");
            console.log("📝 [AI에게 넘겨줄 실제 메일 본문 내용 요약]:");
            console.log(threadHistory.trim());
            console.log("==================================================================\n");
            // OpenAI 구조화된 데이터 추출 가이드 강화
            const aiResponse = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You are an executive AI assistant. Your task is to analyze the email thread history and determine if there is a CONFIRMED schedule or a TENTATIVE schedule proposal still being negotiated.
                        Current year is 2026.
                        
                        [Rules]
                        1. "has_schedule" (Boolean): Set this to TRUE *ONLY* if the email chain shows a clear, mutually agreed final confirmation where BOTH parties said "Yes, let's meet then". 
                        - If the email is a general announcement, a one-sided notification of time change, an invitation to an event, or still in negotiation, you MUST set "has_schedule" to FALSE.
                        2. "is_negotiating" (Boolean): Set this to TRUE if the email is a one-sided time change notification, an announcement, or containing proposed tentative options. These must go to the user's pending dashboard for manual confirmation.
                        3. "start_iso": Extract or estimate the exact event start time in ISO 8601 format (e.g., "2026-05-18T19:00:00").
                        4. "suggested_reply": Draft a professional English reply assuming the user wants to accept the first viable option or ask to confirm.
                        
                         [Decision Tree Example]
                        - "The dinner time has been changed to 7 PM today" (General Announcement) -> has_schedule: false, is_negotiating: true (Needs manual review).
                        - "Okay, see you at 7 PM then!" (Both agreed) -> has_schedule: true, is_negotiating: false.

                        [CRITICAL TIMING RULE]
                        - Use the "Email Sent Date" provided at the top of the user's prompt as the absolute baseline anchor for "Today".
                        - If the email content says "Today" or "오늘", it strictly refers to that "Email Sent Date".
                        - Do not assume the current time is post-dated. Trust the "Email Sent Date" for calculating all relative dates.

                       

                        [FILTERING & REGISTRATION RULES]
                        - Case 1: If BOTH parties mutually agreed and confirmed a specific date/time -> has_schedule: true, is_negotiating: false.
                        - Case 2: If the email is about an event announcement, time-change notification, or back-and-forth negotiation options -> has_schedule: false, is_negotiating: true.
                        - Case 3: If the email has ABSOLUTELY NOTHING to do with a specific meeting, appointment, event, or schedule (e.g., newsletters, plain inquiries, receipts, spam, general chatter) -> You MUST set BOTH "has_schedule" to false AND "is_negotiating" to false.
                        
                        [Strict Instruction for Case 3]
                        If there is no date/time action item or schedule context at all, set both booleans to false. Do not try to guess a date.
                            `
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
                                start_iso: { type: "string", description: "ISO 8601 Extended Format (YYYY-MM-DDTHH:mm:ss)" },
                                duration: { type: "string", description: "e.g., '1h', '2h'" },
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
            // 🚨 디버깅용 터미널 콘솔 로그 (AI가 해석한 날짜를 눈으로 검증하는 용도)
            console.log("==========================================");
            console.log(`🤖 AI 최종 판정 -> 확정등록(has_schedule): ${ eventData.has_schedule } / 대시보드행(is_negotiating): ${ eventData.is_negotiating }`);
            console.log("==========================================");

            // 확정된 일정이면 기존처럼 구글 캘린더에 바로 삽입
            if (eventData.has_schedule) {
                let colorId = '1';
                if (eventData.calendar_type === 'PSYCH') colorId = '3';
                if (eventData.calendar_type === 'STUDY') colorId = '2';

                const matchedDuration = eventData.duration.match(/(\d+)h/);
                const hours = matchedDuration ? parseInt(matchedDuration[1]) : 1;

                const startDateTime = new Date(eventData.start_iso);
                const endDateTime = new Date(startDateTime.getTime() + hours * 60 * 60 * 1000);

                // 🎯 [중복 제거 로직 추가] 
                // 새 일정을 넣기 전에, 구글 캘린더에서 같은 날짜 범위에 같은 제목을 가진 일정이 이미 있는지 조회합니다.
                const existingEvents = await calendar.events.list({
                    calendarId: 'primary',
                    timeMin: new Date(startDateTime.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 앞뒤로 2시간 여유 검색
                    timeMax: new Date(endDateTime.getTime() + 2 * 60 * 60 * 1000).toISOString(),
                    q: eventData.title, // 같은 제목 키워드로 검색
                });

                // 만약 기존에 똑같은 스케줄(또는 구 버전 스케줄)이 발견된다면 싹 지워버립니다.
                if (existingEvents.data.items && existingEvents.data.items.length > 0) {
                    for (const oldEvent of existingEvents.data.items) {
                        console.log(`🗑️ 중복 또는 변경 전 구 일정 발견 및 삭제 완료: ${ oldEvent.summary }`);
                        await calendar.events.delete({
                            calendarId: 'primary',
                            eventId: oldEvent.id
                        });
                    }
                }

                await calendar.events.insert({
                    calendarId: 'primary',
                    requestBody: {
                        summary: eventData.title,
                        location: eventData.location,
                        description: eventData.description,
                        colorId: colorId,
                        start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
                        end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
                    },
                });

                debugResults.push({ subject: emailSubject, status: "캘린더 즉시 등록 완료" });

            } else if (eventData.is_negotiating) {
                // [조율/통보 일정] 대시보드용 Redis 보관 로직
                const redisKey = `pending_meeting:${ threadId }`;
                const payload = JSON.stringify({
                    threadId: threadId,
                    subject: emailSubject,
                    title: eventData.title,
                    proposed_dates: eventData.proposed_dates,
                    suggested_reply: eventData.suggested_reply,
                    calendar_type: eventData.calendar_type,
                    duration: eventData.duration,
                    location: eventData.location,
                    estimated_start: eventData.start_iso
                });
                await redisClient.set(redisKey, payload); // 👈 Redis에 쏙!
                debugResults.push({ subject: emailSubject, status: "대시보드 보관함(Redis)으로 이동" });
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
        await redisClient.disconnect();
        return NextResponse.json({ success: true, processed_count: processedThreadIds.size, details: debugResults });

    } catch (error) {
        console.error("Automation Error:", error);
        try { await redisClient.disconnect(); } catch (e) { }
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}