'use client';

import { useState, useEffect } from 'react';

// 🎯 Redis에서 가져올 대기 중인 일정 데이터의 타입 정의
interface PendingMeeting {
  threadId: string;
  subject: string;
  title: string;
  proposed_dates: string;
  suggested_reply: string;
  calendar_type: string;
  duration: string;
  location?: string;
  estimated_start?: string;
  status?: 'PENDING' | 'NEGOTIATING';
  description?: string;
  meeting_timezone?: string;
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
          <p className="text-sm text-slate-500 mt-1">AI가 조율 중이거나 변경 공지를 감지한 스케줄 리스트입니다. 확인 후 승인하거나 바로 답장을 보내세요.</p>
        </div>

        {loading ? (
          /* 로딩 전용 스켈레톤 카드 UI */
          <div className="grid gap-6 md:grid-cols-2 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="h-96 bg-white border border-slate-200 rounded-xl" />
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
          /* 🎯 분리된 개별 미팅 카드 컴포넌트로 매핑 렌더링 */
          <div className="grid gap-6 md:grid-cols-2">
            {meetings.map((meeting) => (
              <MeetingCard
                key={meeting.threadId}
                meeting={meeting}
                isConfirmLoading={!!actionLoading[meeting.threadId]}
                onConfirm={handleConfirm}
                onEmailSent={(threadId) => {
                  // 이메일 답장 전송 성공 시 대시보드 리스트에서 제거 유도
                  setMeetings((prev) => prev.filter((m) => m.threadId !== threadId));
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

interface MeetingCardProps {
  meeting: PendingMeeting;
  isConfirmLoading: boolean;
  onConfirm: (threadId: string) => void;
  onEmailSent: (threadId: string) => void;
}

/* 🎯 개별 카드 컴포넌트: 내부 상태(textarea 입력값, 전송 로딩)를 독립적으로 관리합니다 */
function MeetingCard({ meeting, isConfirmLoading, onConfirm, onEmailSent }: MeetingCardProps) {
  const [replyText, setReplyText] = useState<string>(meeting.suggested_reply || '');
  const [isEmailSending, setIsEmailSending] = useState<boolean>(false);

  // 카테고리 태그 스타일 매핑 함수
  const getBadgeColor = (type: PendingMeeting['calendar_type']): string => {
    switch (type) {
      case 'CHURCH': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'PSYCH': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'STUDY': return 'bg-amber-50 text-amber-700 border-amber-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  // 🎯 이메일 답장 전송 처리 핸들러
  const handleSendEmailReply = async (actionType: 'confirm' | 'negotiate') => {
    if (!replyText.trim()) return alert('본문을 입력해 주세요.');

    const confirmMsg = actionType === 'confirm'
      ? '이 메일을 보내고 일정을 확정/종료할까요? (대시보드에서 제외)'
      : '시간 조율 메일을 보낼까요? (대시보드에 [조율중] 상태로 유지)';

    if (!window.confirm(confirmMsg)) return;

    setIsEmailSending(true);
    try {
      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: meeting.threadId,
          replyText: replyText,
          actionType: actionType,

          // 🔥 안전하게 언디파인드 가드를 장착하여 데이터 바인딩
          eventDetails: {
            title: meeting.title,
            estimated_start: meeting.estimated_start,
            duration: meeting.duration || "1h",
            location: meeting.location || "",
            calendar_type: meeting.calendar_type,
            description: meeting.description || "", 
            meeting_timezone: meeting.meeting_timezone || "" 
          }
        }),
      });

      const result = await res.json();
      if (result.success) {
        alert('🚀 메일이 성공적으로 발송되었습니다!');

        if (actionType === 'confirm') {
          onEmailSent(meeting.threadId); // 확정이면 대시보드에서 제거
        } else {
          // 조율 중이면 화면을 리프레시하거나 상태를 'NEGOTIATING'으로 로컬 변경
          alert('이 카드는 상대방의 회신을 기다리기 위해 [조율 중] 상태로 유지됩니다.');
          window.location.reload();
        }
      }
    } catch (error) {
      alert('통신 에러 발생');
    } finally {
      setIsEmailSending(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col overflow-hidden">

      {/* 카드 제목부 */}
      <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-start gap-3">
        <div className="space-y-1">
          <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-md border ${getBadgeColor(meeting.calendar_type)}`}>
            {meeting.calendar_type}
          </span>
          <h2 className="text-base font-bold text-slate-900 line-clamp-1 mt-1.5">{meeting.title || meeting.subject}</h2>
        </div>
      </div>

      {/* 일정 메타 상세 내역 */}
      <div className="p-5 space-y-4 flex-1 text-sm">
        <div className="flex items-start space-x-3">
          <span className="text-slate-400 w-5 text-center mt-0.5">📅</span>
          <div className="text-slate-700">
            <span className="font-semibold block text-slate-900 text-xs text-slate-400 uppercase tracking-wider">제안된 일시</span>
            <p className="text-slate-600 mt-0.5">{meeting.proposed_dates || "본문 내용 확인 필요"}</p>
          </div>
        </div>

        {meeting.location && (
          <div className="flex items-start space-x-3">
            <span className="text-slate-400 w-5 text-center mt-0.5">📍</span>
            <div className="text-slate-700">
              <span className="font-semibold block text-slate-900 text-xs text-slate-400 uppercase tracking-wider">장소</span>
              <p className="text-slate-600 mt-0.5 line-clamp-1">{meeting.location}</p>
            </div>
          </div>
        )}

        {/* 📝 디벨롭: 수정 가능한 AI 추천 답장 에디터 컴포넌트 */}
        {meeting.suggested_reply && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col flex-1">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">AI Suggested Reply (수정 가능)</span>
            </div>
            <textarea
              className="w-full text-xs text-slate-700 bg-slate-50/80 border border-slate-200 rounded-xl p-3 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition font-mono leading-relaxed resize-none flex-1 min-h-[120px]"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="상대방에게 보낼 영문 답장 내용을 입력하세요..."
            />
          </div>
        )}
      </div>

      {/* 🛠️ 최종 액션 버튼 섹션 (구글 컨펌 버튼 및 이메일 전송 버튼 병렬 배치) */}
      <div className="p-4 bg-slate-50 border-t border-slate-100 grid grid-cols-2 gap-2">
        {/* 1. 구글 캘린더 등록 승인 버튼 */}
        <button
          onClick={() => onConfirm(meeting.threadId)}
          disabled={isConfirmLoading || isEmailSending}
          className="bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 font-medium text-xs py-2.5 px-3 rounded-xl shadow-xs transition-colors disabled:bg-slate-100 disabled:text-slate-400 flex items-center justify-center space-x-1.5"
        >
          {isConfirmLoading ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>등록 중...</span>
            </>
          ) : (
            <span>🗓️ 캘린더 승인</span>
          )}
        </button>

        {/* 2. ✉️ 디벨롭: 수정한 메일 바로 전송 버튼 */}
        <div className="grid grid-cols-2 gap-2">
          {/* 🔄 트랙 1: 조율 상태로 유지하며 메일 발송 */}
          <button
            onClick={() => handleSendEmailReply('negotiate')}
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 ... py-2 rounded-xl text-xs font-medium"
          >
            🔄 시차/시간 조율 메일 회신
          </button>

          {/* ✉️ 트랙 2: 확정 짓고 대시보드에서 삭제 */}
          <button
            onClick={() => handleSendEmailReply('confirm')}
            className="bg-slate-950 hover:bg-slate-900 text-white ... py-2 rounded-xl text-xs font-medium"
          >
            ✉️ 확정 메일 보내고 종료
          </button>
        </div>
      </div>

    </div>
  );
}