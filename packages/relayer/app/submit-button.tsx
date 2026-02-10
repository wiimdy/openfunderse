'use client';

export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="flex h-10 w-full items-center justify-center rounded-md border text-sm transition-all focus:outline-none"
    >
      {children}
    </button>
  );
}
