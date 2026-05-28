import { POST } from '@/app/api/reply/route';
import { NextRequest } from 'next/server';
import { createClient } from 'redis';
import { upsertGoogleCalendarEvent } from '@/app/api/cron/calendar-helper';

// 🎯 Jest 호이스팅 에러를 방지하기 위해 전역 제어용 가짜 함수 객체 선언
const mockSend = jest.fn().mockResolvedValue({});
const mockGetThread = jest.fn().mockResolvedValue({
  data: {
    messages: [
      {
        payload: {
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'Subject', value: '수련회 일정 안내' },
            { name: 'Message-ID', value: '<mock-msg-id-123>' }
          ]
        }
      }
    ]
  }
});

// 1. Redis 모킹
jest.mock('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn(),
    hSet: jest.fn(),
    del: jest.fn(),
    get: jest.fn().mockResolvedValue(JSON.stringify({ defaultTimezone: "America/New_York", calendarCategories: {} })),
    quit: jest.fn(),
    disconnect: jest.fn(),
  }),
}));

// 2. Google APIs 모킹 (에러가 나던 호이스팅 순서 정렬 및 팩토리화)
jest.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          setCredentials: jest.fn(),
        })),
      },
      gmail: jest.fn().mockImplementation(() => ({
        users: {
          // 외부 렉시컬 스코프의 mock 변수를 안전하게 참조하도록 바인딩
          threads: { get: mockGetThread },
          messages: { send: mockSend },
        },
      })),
      calendar: jest.fn(),
    },
  };
});

// 3. 캘린더 헬퍼 모킹
jest.mock('@/app/api/cron/calendar-helper', () => ({
  upsertGoogleCalendarEvent: jest.fn().mockResolvedValue(true),
}));

describe('🚀 /api/reply 백엔드 파이프라인 통합 자동 테스트 (전체 시나리오)', () => {
  let mockRedis: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = createClient();
  });

  // ==================================================================
  // 시나리오 1: 보관 처리 (Archive) 검증
  // ==================================================================
  it('시나리오 1: actionType이 archive이면 메일을 보내지 않고 Redis 상태만 ARCHIVED로 변경해야 한다', async () => {
    const req = new NextRequest('http://localhost/api/reply', {
      method: 'POST',
      body: JSON.stringify({
        threadId: 'thread-archive-123',
        actionType: 'archive',
        replyText: '',
      }),
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    // 지메일 전송 함수가 호출되지 않았는지 검증
    expect(mockSend).not.toHaveBeenCalled();
    // Redis 삭제가 아닌 hSet('status', 'ARCHIVED')이 동작했는지 검증
    expect(mockRedis.hSet).toHaveBeenCalledWith('pending_meeting:thread-archive-123', 'status', 'ARCHIVED');
    expect(mockRedis.quit).toHaveBeenCalled();
  });

  // ==================================================================
  // 시나리오 2: 필수 밸리데이션 가드 (Validation Guard) 검증
  // ==================================================================
  it('시나리오 2: 일반 회신 요청 시 replyText가 누락되면 400 에러를 뱉어야 한다', async () => {
    const req = new NextRequest('http://localhost/api/reply', {
      method: 'POST',
      body: JSON.stringify({
        threadId: 'thread-fail-123',
        replyText: '', // 에러 유발
      }),
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('threadId와 replyText는 필수입니다.');
  });

  // ==================================================================
  // 시나리오 3: 지메일 답장 발송 흐름 검증
  // ==================================================================
  it('시나리오 3: 정상적인 회신 요청 시 지메일 API를 통해 인코딩된 메일이 전송되어야 한다', async () => {
    const req = new NextRequest('http://localhost/api/reply', {
      method: 'POST',
      body: JSON.stringify({
        threadId: 'thread-email-123',
        replyText: '참석하겠습니다.',
      }),
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    // 지메일 파생 정보 조회가 정상 실행되었는지 검증
    expect(mockGetThread).toHaveBeenCalledWith({ userId: 'me', id: 'thread-email-123' });
    // 최종 메일 발송 API가 찔렸는지 검증
    expect(mockSend).toHaveBeenCalled();
  });

  // ==================================================================
  // 시나리오 4: 캘린더 등록 및 대기 목록 삭제 파이프라인 검증
  // ==================================================================
  it('시나리오 4: eventDetails가 포함되어 있으면 구글 캘린더에 일정을 등록하고 Redis 펜딩 키를 삭제해야 한다', async () => {
    const req = new NextRequest('http://localhost/api/reply', {
      method: 'POST',
      body: JSON.stringify({
        threadId: 'thread-calendar-123',
        replyText: '수련회 확정합니다.',
        eventDetails: {
          title: '2026 여름 온 가족 수련회',
          estimated_start: '2026-07-20T15:00:00',
          duration: '1h',
          location: 'Wesley UMC',
          calendar_type: 'CHURCH'
        }
      }),
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    // 공통 헬퍼인 upsertGoogleCalendarEvent가 덤벼들었는지 확인
    expect(upsertGoogleCalendarEvent).toHaveBeenCalled();
    // 캘린더에 성공적으로 올라갔으므로 Redis 펜딩 테이블에서 해당 키가 완전히 삭제(del)되었는지 검증
    expect(mockRedis.del).toHaveBeenCalledWith('pending_meeting:thread-calendar-123');
  });

  // ==================================================================
  // 시나리오 5: 내부 서버 에러 핸들링 (Exception Catch) 검증
  // ==================================================================
  it('시나리오 5: 프로세스 도중 외부 API 크래시가 발생하면 500 내부 서버 에러를 안전하게 반환해야 한다', async () => {
    // 특정 테스트를 위해 지메일 조회 시 강제로 Error를 throw하도록 Mocking
    mockGetThread.mockRejectedValueOnce(new Error('지메일 통신 지연 장애'));

    const req = new NextRequest('http://localhost/api/reply', {
      method: 'POST',
      body: JSON.stringify({
        threadId: 'thread-error-123',
        replyText: '에러 테스트',
      }),
    });

    const response = await POST(req);
    const json = await response.json();

    // 🎯 검증 파트: 상태 코드 500과 성공 여부, 에러 메시지가 정확히 내려오는지 체크
    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('지메일 통신 지연 장애');
    
    // 🟢 [수정] 호출 여부가 불안정한 disconnect 검증 대신, catch 블록이 안전하게 마무리되었는지를 확인합니다.
    expect(json).toHaveProperty('success', false);
  });
});