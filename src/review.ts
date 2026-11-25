const extensions = "pdf jpg jpeg png bmp tif tiff heic docx pptx xlsx mp4 mov m4v avi mkv webm wmv flv mpg mpeg 3gp".split(" ");
export const accept = extensions.map((extension) => "." + extension).join(",");
export const maxFileBytes = 500_000_000;

export function validateFile(file: File): string | undefined {
  if (!extensions.includes(file.name.split(".").pop()!.toLowerCase()) || !file.name.includes(".")) {
    return "Choose a supported document, image, or video format.";
  }
  if (file.size === 0) return "The file is empty. Choose another file.";
  if (file.size > maxFileBytes) return "The file exceeds the 500 MB limit.";
}

export type ReviewResponse =
  | { state: "processing"; run: string }
  | { state: "completed"; result: unknown }
  | { state: "error"; message: string; unknown?: boolean; retry?: boolean; delay?: number };
