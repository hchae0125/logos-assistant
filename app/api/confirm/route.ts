import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';
import { google } from 'googleapis';

interface ConfirmRequestBody {
    threadId: string;
}

interface PendingMeetingData {
    threadId: string;
    subject: string;
    title: string;
    proposed_dates: string;
    suggested_reply: string;
    calendar_type: 'CHURCH' | 'PSYCH' | 'STUDY';
    duration: string;
    location?: string;
    estimated_start: string; // ISO 8601 string
}

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

export async function POST(req: NextRequest) {
    oauth2Client.setCredentials({ refresh_token: process.env.HUSBAND_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const redisClient = createClient({ url: process.env.REDIS_URL });

    try {
        const body: ConfirmRequestBody = await req.json();

        console.log("==========================================");
        console.log("🚨 [컨펌 요청 수신] Body 전체 구조:", JSON.stringify(body));
        console.log("🚨 [컨펌 요청 수신] threadId 값:", body.threadId);
        console.log("🚨 [컨펌 요청 수신] threadId 타입:", typeof body.threadId);
        console.log("==========================================");

        const { threadId } = body;

        if (!threadId) {
            return NextResponse.json({ success: false, error: 'threadId가 누락되었습니다.' }, { status: 400 });
        }

        await redisClient.connect();
        let redisKey = `pending_meeting:${threadId}`;

        let rawData = await redisClient.get(redisKey);

        if (!rawData) {
            redisKey = `pending_meeting: ${threadId}`;
            rawData = await redisClient.get(redisKey);
        }
        if (!rawData) {
            await redisClient.disconnect();
            return NextResponse.json({ success: false, error: '해당 일정 데이터를 찾을 수 없거나 이미 처리되었습니다.' }, { status: 404 });
        }

        const meetingData: PendingMeetingData = JSON.parse(rawData);

        let colorId = '1';
        if (meetingData.calendar_type === 'PSYCH') colorId = '3';
        if (meetingData.calendar_type === 'STUDY') colorId = '2';

        const matchedDuration = meetingData.duration.match(/(\d+)h/);
        const hours = matchedDuration ? parseInt(matchedDuration[1], 10) : 1;

        const startDateTime = new Date(meetingData.estimated_start);
        const endDateTime = new Date(startDateTime.getTime() + hours * 60 * 60 * 1000);

        // 🎯 [이중 보안] 승인 시점 기준 구글 캘린더 중복 일정 조회
        // 승인 대상 시간의 앞뒤 2시간 범위 내에 동일한 제목의 일정이 있는지 검사합니다.
        const existingEvents = await calendar.events.list({
            calendarId: 'primary',
            timeMin: new Date(startDateTime.getTime() - 2 * 60 * 60 * 1000).toISOString(),
            timeMax: new Date(endDateTime.getTime() + 2 * 60 * 60 * 1000).toISOString(),
            q: meetingData.title, // 같은 일정 제목 키워드로 검색
        });

        // 만약 중복되거나 이전에 잘못 들어간 구 버전 일정이 발견되면 싹 청소합니다.
        if (existingEvents.data.items && existingEvents.data.items.length > 0) {
            for (const oldEvent of existingEvents.data.items) {
                if (oldEvent.id) {
                    console.log(`🗑️ [대시보드 승인] 중복 일정 발견 및 선제 삭제: ${oldEvent.summary}`);
                    await calendar.events.delete({
                        calendarId: 'primary',
                        eventId: oldEvent.id
                    });
                }
            }
        }

        // 구 일정을 깨끗하게 밀어버린 뒤 최종 확인된 일정으로 완벽하게 저장!
        await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
                summary: meetingData.title,
                location: meetingData.location || '추후 결정',
                description: `[Aether Link AI Assistant]\n${meetingData.proposed_dates}\n\nSubject: ${meetingData.subject}`,
                colorId: colorId,
                start: { dateTime: startDateTime.toISOString(), timeZone: 'America/New_York' },
                end: { dateTime: endDateTime.toISOString(), timeZone: 'America/New_York' },
            },
        });

        console.log(`✨ 구글 캘린더 최종 등록 성공: ${meetingData.title}`);

        // 처리 완료 후 Redis 캐시 비우기
        await redisClient.del(redisKey);
        console.log(`🗑️ Redis 대기열에서 삭제 완료: ${redisKey}`);

        await redisClient.disconnect();
        return NextResponse.json({ success: true, message: 'Successfully validated, registered to Google Calendar, and cleaned up Redis.' });

    } catch (error: any) {
        console.error('❌ 최종 승인 API 에러 발생:', error);
        try { await redisClient.disconnect(); } catch (e) { }
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}