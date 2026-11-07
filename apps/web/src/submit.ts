import {
  type DefaultError,
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
} from '@tanstack/react-query';
import { useRef } from 'react';
import { isStale } from './api.ts';
import { reportStale } from './stale.tsx';

/**
 * A mutation that runs once at a time, for every submit and every one-click action. The query
 * library renders `isPending` after the event that started the request, so a second click or a
 * second Enter can arrive before the button is disabled. A lock taken synchronously by `mutate`
 * refuses it; it is released once the request and its `onSuccess` or `onError` are over, so a
 * save that navigates away keeps it until the new page is shown.
 *
 * A write refused because the record changed since it was read (ADR-005) opens the one dialog
 * that says so, and nothing else: the mutation is reset before the error reaches its state, so
 * the form shows no message of its own.
 */
export function useSubmit<TData = unknown, TError = DefaultError, TVariables = void>(
  options: UseMutationOptions<TData, TError, TVariables>,
): UseMutationResult<TData, TError, TVariables> {
  const lock = useRef(false);
  const mutation = useMutation<TData, TError, TVariables>({
    ...options,
    onError: (...args) => {
      if (isStale(args[0])) {
        reportStale();
        return;
      }
      return options.onError?.(...args);
    },
    onSettled: (...args) => {
      lock.current = false;
      if (isStale(args[1])) {
        mutation.reset();
        return;
      }
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
