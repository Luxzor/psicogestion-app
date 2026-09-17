import { useState } from 'react';
import { fieldsFrom, messageFrom } from '../../../auth/api';
import type { Notice } from '../types';

export function useFormFeedback() {
  const [notice, setNotice] = useState<Notice>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function run<T>(
    operation: () => Promise<T>,
    onSuccess: (result: T) => void | Promise<void>,
  ) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setNotice(null);
    setFieldErrors({});
    try {
      const result = await operation();
      await onSuccess(result);
    } catch (error) {
      setFieldErrors(fieldsFrom(error));
      setNotice({ type: 'error', text: messageFrom(error) });
    } finally {
      setIsSubmitting(false);
    }
  }

  return { notice, setNotice, fieldErrors, isSubmitting, run };
}
