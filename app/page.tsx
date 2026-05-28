'use client';

import { useState, useEffect } from 'react';
import MeetingCard from './components/MeetingCard'; // 👈 같은 뎁스의 components 폴더 참조
import { PendingMeeting, ActionLoadingState } from './types'; // 👈 루트 types 참조

export default function Home() { // 메인이므로 Home으로 명명해도 무방합니다.
  const [meetings, setMeetings] = useState<PendingMeeting[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<ActionLoadingState>({});
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');

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

  // 📄 app/page.tsx 내부의 handleArchive 함수를 찾아서 아래처럼 교체해 주세요.

  const handleArchive = async (threadId: string) => {
    if (!window.confirm('이 일정을 대시보드에서 제외하고 보관함으로 이동할까요?')) return;

    try {
      // 🎯 메일 발송 라우트(/api/reply)의 유효성 검사를 통과하기 위해
      // 필수 값인 replyText에 빈 문자열("")을 명시적으로 채워서 보냅니다.
      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: threadId,
          actionType: 'archive', // 백엔드에서 이 값을 보고 메일 발송 대신 보관 처리를 유도함
          replyText: ""          // 👈 밸리데이션 통과를 위한 가드 플레이스홀더
        }),
      });

      const result = await res.json();

      if (result.success) {
        alert('📦 보관함으로 안전하게 이동되었습니다.');

        // 화면에서 카드 실시간 제거 (혹은 상태 업데이트)
        // 만약 셋터 함수명이 다르면 기존 새로고침 로직(window.location.reload())을 쓰셔도 됩니다.
        if (typeof setMeetings === 'function') {
          setMeetings(prev => prev.filter(m => m.threadId !== threadId));
        } else {
          window.location.reload();
        }
      } else {
        alert(`보관 실패: ${result.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('Archive Error:', error);
      alert('보관 처리 중 내부 통신 에러가 발생했습니다.');
    }
  };

  const activeMeetings = meetings.filter((m) => m.status !== 'ARCHIVED');
  const archivedMeetings = meetings.filter((m) => m.status === 'ARCHIVED');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 antialiased font-sans">
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

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">스케줄 관리 대시보드</h1>
            <p className="text-sm text-slate-500 mt-1">AI가 감지한 일정을 확인하여 확정 메일을 보내거나 보관함으로 패스하세요.</p>
          </div>

          <div className="flex bg-slate-200/70 p-1 rounded-xl border border-slate-200 self-start sm:self-center">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${activeTab === 'active' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              📬 대기 목록 ({activeMeetings.length})
            </button>
            <button
              onClick={() => setActiveTab('archived')}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${activeTab === 'archived' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              📦 보관함 / 패스 ({archivedMeetings.length})
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-6 md:grid-cols-2 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="h-96 bg-white border border-slate-200 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            {activeTab === 'active' && (
              activeMeetings.length === 0 ? (
                <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl shadow-sm">
                  <div className="text-4xl mb-3">✨</div>
                  <h3 className="text-lg font-semibold text-slate-800">대기 중인 일정이 없습니다</h3>
                  <p className="text-sm text-slate-400 mt-1">모든 일정이 깔끔하게 컨펌되었거나 패스되었습니다.</p>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {activeMeetings.map((meeting) => (
                    <MeetingCard
                      key={meeting.threadId}
                      meeting={meeting}
                      isConfirmLoading={!!actionLoading[meeting.threadId]}
                      onConfirm={handleConfirm}
                      onArchive={handleArchive}
                      onEmailSent={(threadId) => {
                        setMeetings((prev) => prev.filter((m) => m.threadId !== threadId));
                      }}
                    />
                  ))}
                </div>
              )
            )}

            {activeTab === 'archived' && (
              archivedMeetings.length === 0 ? (
                <div className="text-center py-16 bg-white border border-slate-200 rounded-2xl shadow-sm">
                  <div className="text-4xl mb-3">📦</div>
                  <h3 className="text-lg font-semibold text-slate-800">보관함이 비어있습니다</h3>
                  <p className="text-sm text-slate-400 mt-1">패스 처리하여 보관해 둔 이벤트가 없습니다.</p>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {archivedMeetings.map((meeting) => (
                    <MeetingCard
                      key={meeting.threadId}
                      meeting={meeting}
                      isConfirmLoading={!!actionLoading[meeting.threadId]}
                      onConfirm={handleConfirm}
                      onArchive={handleArchive}
                      isArchivedView={true}
                      onEmailSent={(threadId) => {
                        setMeetings((prev) => prev.filter((m) => m.threadId !== threadId));
                      }}
                    />
                  ))}
                </div>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}