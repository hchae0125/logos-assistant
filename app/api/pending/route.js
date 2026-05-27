import { NextResponse } from 'next/server';
import { createClient } from 'redis'; // 👈 순수 Redis 로드

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();

    const allKeys = await redisClient.keys('*');
    
    // 1. 'pending_meeting:*'로 시작하는 모든 키 목록을 긁어옵니다.
    const keys = await redisClient.keys('pending_meeting:*');
    
    let pendingList = [];
    
    // 2. 루프를 돌면서 각 키에 든 JSON 텍스트 데이터를 다시 객체로 변환해서 합칩니다.
    for (const key of keys) {
      const rawData = await redisClient.get(key);
      if (rawData) {
        pendingList.push(JSON.parse(rawData));
      }
    }
    
    await redisClient.disconnect();
    
    return NextResponse.json({ success: true, data: pendingList }, { status: 200 });
    
  } catch (error) {
    console.error("Redis Fetch Error:", error);
    try { await redisClient.disconnect(); } catch (e) {}
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}