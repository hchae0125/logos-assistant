// app/api/profile/seed/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });

  // 🎯 내 실제 환경과 브랜드에 맞춘 마스터 프로필 데이터 구조
  const myProfile = {
    userName: "Changyong Shin",
    brandName: "",
    defaultTimezone: "America/New_York",
    blogName: "",
    calendarCategories: {
      CHURCH: "Church ministry, sermons, retreats, and community-related group events.",
      PSYCH: "Psychology counseling, medical checkups, or therapy sessions.",
      INDIV: "Individual schedules."
    },
    preferences: "Always prefer clear, compact event titles. For multi-day group events (like retreats), log the first starting date as estimated_start."
  };

  try {
    await redisClient.connect();

    // Redis에 'user_profile:husband'라는 키로 JSON 문자열로 저장
    const profileKey = 'user_profile:husband';
    await redisClient.set(profileKey, JSON.stringify(myProfile));

    await redisClient.disconnect();
    
    return NextResponse.json({ 
      success: true, 
      message: "Redis에 프로필 주입 완료!",
      data: myProfile 
    });

  } catch (error: any) {
    try { await redisClient.disconnect(); } catch (e) {}
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}