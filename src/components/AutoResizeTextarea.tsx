import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

// Textarea that auto-grows to fit its content. Used across the Copy tab
// (long answers + script editor). Width comes from className; height
// tracks scrollHeight as the user types.
interface AutoResizeTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number | string;
}

export const AutoResizeTextarea = ({
  value,
  onChange,
  placeholder,
  className,
  minHeight,
}: AutoResizeTextareaProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      onInput={adjustHeight}
      placeholder={placeholder}
      className={cn('resize-none overflow-hidden', className)}
      style={{ minHeight }}
      rows={1}
    />
  );
};
