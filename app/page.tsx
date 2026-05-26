'use client';

import { useState, useEffect } from 'react';

// 🎯 Redis에서 가져올 대기 중인 일정 데이터의 타입 정의
interface PendingMeeting {
  threadId: string;
  subject: string;
  title: string;
  proposed_dates: string;
  suggested_reply: string;
  calendar_type: 'CHURCH' | 'PSYCH' | 'STUDY';
  duration: string;
  location?: string;
  estimated_start?: string;
}

// 로딩 상태 관리를 위한 맵 인터페이스 (Key: threadId, Value: boolean)
interface ActionLoadingState {
  [key: string]: boolean;
}

export default function Dashboard() {
  const [meetings, setMeetings] = useState<PendingMeeting[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<ActionLoadingState>({});

  // 1. Redis 대기 리스트 API 호출
  useEffect(() => {
    async function fetchPendingMeetings() {
      try {
        const res = await fetch('/api/pending');
        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
          setMeetings(result.data);
        }
      } catch (error) {
        console.error('데이터 로드 실패:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchPendingMeetings();
  }, []);

  // 2. 구글 캘린더 등록 최종 승인 함수
  const handleConfirm = async (threadId: string) => {
    setActionLoading((prev) => ({ ...prev, [threadId]: true }));
    try {
      const res = await fetch('/api/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId }),
      });
      
      const result = await res.json();
      if (result.success) {
        alert('📅 구글 캘린더에 일정이 성공적으로 등록되었습니다!');
        // 처리 완료된 카드는 화면 리스트에서 즉시 제외
        setMeetings((prev) => prev.filter((m) => m.threadId !== threadId));
      } else {
        alert(`에러 발생: ${result.error}`);
      }
    } catch (error) {
      alert('서버 통신 중 에러가 발생했습니다.');
    } finally {
      setActionLoading((prev) => ({ ...prev, [threadId]: false }));
    }
  };

  // 3. AI 추천 답장 텍스트 클립보드 복사 함수
  const handleCopyReply = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('📋 추천 영어 답장이 클립보드에 복사되었습니다!');
  };

  // 카테고리 태그 스타일 매핑 함수
  const getBadgeColor = (type: PendingMeeting['calendar_type']): string => {
    switch (type) {
      case 'CHURCH': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'PSYCH': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'STUDY': return 'bg-amber-50 text-amber-700 border-amber-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 antialiased font-sans">
      {/* 상단 미니멀 네비게이션 헤더 */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              Aether Link
            </span>
            <span className="text-xs bg-slate-100 text-slate-600 font-medium px-2 py-0.5 rounded-full border border-slate-200">
              스케줄링 어시스턴트
            </span>
          </div>
          <div className="text-sm font-medium text-slate-500">
            {new Date().toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 바디 */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">컨펌 대기 중인 일정</h1>
          <p className="text-sm text-slate-500 mt-1">AI가 조율 중이거나 변경 공지를 감지한 스케줄 리스트입니다. 확인 후 승인해 주세요.</p>
        </div>

        {loading ? (
          /* 로딩 전용 스켈레톤 카드 UI */
          <div className="grid gap-6 md:grid-cols-2 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="h-64 bg-white border border-slate-200 rounded-xl" />
            ))}
          </div>
        ) : meetings.length === 0 ? (
          /* 리스트가 비어있을 때 안내 UI */
          <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="text-4xl mb-3">✨</div>
            <h3 className="text-lg font-semibold text-slate-800">모든 일정이 깔끔하게 정리되었습니다</h3>
            <p className="text-sm text-slate-400 mt-1">새로 감지된 검토 대기 스케줄이 없습니다.</p>
          </div>
        ) : (
          /* 실제 펜딩 스케줄 카드 렌더링 */
          <div className="grid gap-6 md:grid-cols-2">
            {meetings.map((meeting) => (
              <div key={meeting.threadId} className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col overflow-hidden">
                
                {/* 카드 제목부 */}
                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-start gap-3">
                  <div className="space-y-1">
                    <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-md border ${getBadgeColor(meeting.calendar_type)}`}>
                      {meeting.calendar_type}
                    </span>
                    <h2 className="text-base font-bold text-slate-900 line-clamp-1 mt-1.5">{meeting.title}</h2>
                  </div>
                </div>

                {/* 일정 메타 상세 내역 */}
                <div className="p-5 space-y-3.5 flex-1 text-sm">
                  <div className="flex items-start space-x-3">
                    <span className="text-slate-400 w-5 text-center mt-0.5">📅</span>
                    <div className="text-slate-700">
                      <span className="font-semibold block text-slate-900">제안된 일시</span>
                      <p className="text-slate-600 mt-0.5">{meeting.proposed_dates || "본문 내용 확인 필요"}</p>
                    </div>
                  </div>

                  {meeting.location && (
                    <div className="flex items-start space-x-3">
                      <span className="text-slate-400 w-5 text-center mt-0.5">📍</span>
                      <div className="text-slate-700">
                        <span className="font-semibold block text-slate-900">장소</span>
                        <p className="text-slate-600 mt-0.5 line-clamp-1">{meeting.location}</p>
                      </div>
                    </div>
                  )}

                  {/* AI 추천 답장 본문 컴포넌트 */}
                  {meeting.suggested_reply && (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">AI Suggested Reply</span>
                        <button 
                          onClick={() => handleCopyReply(meeting.suggested_reply)}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors flex items-center space-x-1"
                        >
                          <span>📋 복사하기</span>
                        </button>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/60 max-h-24 overflow-y-auto text-xs text-slate-600 font-mono leading-relaxed whitespace-pre-line">
                        {meeting.suggested_reply}
                      </div>
                    </div>
                  )}
                </div>

                {/* 최종 구글 캘린더 확정 액션 버튼 */}
                <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end space-x-2">
                  <button 
                    onClick={() => handleConfirm(meeting.threadId)}
                    disabled={actionLoading[meeting.threadId]}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm py-2.5 px-4 rounded-xl shadow-sm transition-colors disabled:bg-slate-300 flex items-center justify-center space-x-2"
                  >
                    {actionLoading[meeting.threadId] ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>처리 중...</span>
                      </>
                    ) : (
                      <span>🗓️ 구글 캘린더 등록 승인</span>
                    )}
                  </button>
                </div>

              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}