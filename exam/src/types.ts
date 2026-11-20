export const QUESTION_TYPES = ["single", "multiple", "judge", "blank", "short"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface Question {
  id: string;
  type: QuestionType;
  stem: string;
  options: string[];
  blanks: number;
  score: number;
}

export interface Paper {
  title: string;
  durationMinutes: number | null;
  questions: Question[];
}

export interface AnswerEntry {
  id: string;
  answer: unknown;
  keywords: string[];
  /** Excel blank cells use | and /. JSON uses arrays. */
  excel: boolean;
}

export interface AnswerKey {
  byId: Record<string, AnswerEntry>;
}

export interface FileContent {
  paper: Paper | null;
  key: AnswerKey | null;
}

export type ResponseValue =
  | { type: "single"; index: number | null }
  | { type: "multiple"; indices: number[] }
  | { type: "judge"; value: boolean | null }
  | { type: "blank"; values: string[] }
  | { type: "short"; text: string };

export type GradeStatus = "correct" | "incorrect" | "partial" | "blank" | "ungraded";

export interface GradeItem {
  id: string;
  type: QuestionType;
  stem: string;
  score: number;
  earned: number;
  status: GradeStatus;
  yours: string;
  reference: string;
  note: string;
}

export interface GradeReport {
  total: number;
  gradedMax: number;
  paperMax: number;
  items: GradeItem[];
  missingIds: string[];
  invalidIds: string[];
}
