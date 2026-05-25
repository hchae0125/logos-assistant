import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export async function GET() {
  try {
    // 1. Redis에서 'pending_meeting:*' 패턴을 가진 모든 키들을 조회해옵니다.
    const keys = await kv.keys('pending_meeting:*');
    
    let pendingList = [];
    
    // 2. 찾아낸 키들을 순회하면서 각각의 상세 데이터를 긁어모읍니다.
    for (const key of keys) {
      const data = await kv.hgetall(key);
      if (data) pendingList.push(data);
    }
    
    return NextResponse.json({ success: true, data: pendingList });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}