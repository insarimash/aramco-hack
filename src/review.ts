export const accept = ".pdf";
export const maxFileBytes = 500_000_000;

export function validateFile(file: File): string | undefined {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return "Combine the required documents into one PDF file.";
  }
  if (file.size === 0) return "The file is empty. Choose another file.";
  if (file.size > maxFileBytes) return "The file exceeds the 500 MB limit.";
}

export type ReviewResponse =
  | { state: "processing"; run: string }
  | { state: "completed"; result: unknown }
  | { state: "error"; message: string; unknown?: boolean; retry?: boolean; delay?: number };
