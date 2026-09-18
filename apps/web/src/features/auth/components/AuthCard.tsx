import type { ReactNode } from 'react';
import { AuthLayout } from '../layouts/AuthLayout';

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <AuthLayout title={title} subtitle={subtitle}>
      {children}
    </AuthLayout>
  );
}
