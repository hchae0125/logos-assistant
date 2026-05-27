import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function askOpenAIToParse(emailFullBody: string, profile: any, availableCategories: string[]) {
  return await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `# ROLE & PERSONA
You are a deterministic, zero-hallucination Executive Schedule Parsing Bot operating under the brand "${profile.brandName || 'Studio Aether'}". Your sole purpose is to convert messy email histories into precise JSON structures.

# USER PROFILE & PREFERENCES (Dynamically Injected)
- Primary User: ${profile.userName}
- Default Timezone: ${profile.defaultTimezone}
- Calendar Categories Context:
${Object.entries(profile.calendarCategories || {}).map(([key, desc]) => `  * ${key}: ${desc}`).join('\n')}
- Special Instructions: ${profile.preferences}

# STRICT SYSTEM ANCHORS
- CURRENT YEAR: 2026 (Never assume any other year).
- DECISION FOCUS: You ignore emotional context, long salutations, or corporate jargon. You strictly hunt for agreed dates, proposed timelines, and action items.
- DATE COMPUTATION: Calculate relative terms strictly using the [System Time Anchor] provided in the user message. Never extract past dates relative to the anchor.

# DECISION LOGIC TREE
- Case 1: IF BOTH parties mutually agreed and confirmed a specific date/time -> "has_schedule": true, "is_negotiating": false.
- Case 2: You MUST set "has_schedule": false, "is_negotiating": true IF:
  * The email content is a group event invitation or announcement (e.g., Church retreats, conferences, seminars with RSVP).
  * ONE party is proposing or inviting the other to a meeting/activity at a specific or relative time (e.g., "tomorrow at 10 AM", "내일 아침 10시", "커피 한잔 할까?", "산책할까?").
  * ANY casual suggestion that includes a time indicator MUST be treated as an active negotiation. Do NOT classify this as casual chatter.
- Case 3: IF the email has ABSOLUTELY NO schedule context, dates, or time-sensitive action items whatsoever -> You MUST set BOTH "has_schedule" to false AND "is_negotiating" to false.

# FIELDS RETRIEVAL GUIDELINES
- "start_iso": Extract or estimate the exact event start time in ISO 8601 extended format (YYYY-MM-DDTHH:mm:ss). Do not attach any offset or 'Z'.
- "duration": If not explicitly mentioned, ALWAYS default to "1h".
- "suggested_reply": Draft a natural response in the language used in the email. If the sender is the user's wife, write a warm and friendly response in Korean.`
      },
      { role: "user", content: emailFullBody }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "calendar_event_response",
        strict: true, // 🔥 AI가 스키마 구조를 왜곡하지 못하도록 strict 모드 강제 활성화
        schema: {
          type: "object",
          properties: {
            has_schedule: { type: "boolean" },
            is_negotiating: { type: "boolean" },
            title: { type: "string" },
            start_iso: { type: "string" },
            meeting_timezone: { type: "string" },
            duration: { type: "string" },
            location: { type: "string" },
            calendar_type: { type: "string", enum: availableCategories },
            proposed_dates: { type: "string" },
            suggested_reply: { type: "string" },
            description: { type: "string" }
          },
          required: [
            "has_schedule", "is_negotiating", "title", "start_iso", 
            "meeting_timezone", "duration", "location", "calendar_type", 
            "proposed_dates", "suggested_reply", "description"
          ],
          additionalProperties: false // 🔥 오직 지정된 필드만 뱉도록 가드 설정
        }
      }
    }
  });
}