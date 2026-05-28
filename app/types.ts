export interface PendingMeeting {
  threadId: string;
  subject: string;
  title: string;
  proposed_dates: string;
  suggested_reply: string;
  calendar_type: string;
  duration: string;
  location?: string;
  estimated_start?: string;
  status?: 'PENDING' | 'NEGOTIATING' | 'ARCHIVED'; 
  description?: string;
  meeting_timezone?: string;

  // 🟢 실시간 캘린더 충돌 및 분석 데이터 필드
  calendar_status?: {
    has_conflict: boolean;
    conflicting_event_title?: string;
    alternative_suggestion?: string;
  };
}

export interface ActionLoadingState {
  [key: string]: boolean;
}