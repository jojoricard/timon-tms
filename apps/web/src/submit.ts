import {
  type DefaultError,
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
} from '@tanstack/react-query';
import { useRef } from 'react';

/**
 * A mutation that runs once at a time, for every submit and every one-click action. The query
 * library renders `isPending` after the event that started the request, so a second click or a
 * second Enter can arrive before the button is disabled. A lock taken synchronously by `mutate`
 * refuses it; it is released once the request and its `onSuccess` or `onError` are over, so a
 * save that navigates away keeps it until the new page is shown.
 */
export function useSubmit<TData = unknown, TError = DefaultError, TVariables = void>(
  options: UseMutationOptions<TData, TError, TVariables>,
): UseMutationResult<TData, TError, TVariables> {
  const lock = useRef(false);
  const mutation = useMutation<TData, TError, TVariables>({
    ...options,
    onSettled: (...args) => {
      lock.current = false;
      return options.onSettled?.(...args);
    },
  });
  const mutate: typeof mutation.mutate = (...args) => {
    if (lock.current) return;
    lock.current = true;
    mutation.mutate(...args);
  };
  return { ...mutation, mutate };
}
