import React from 'react';
import { GlassCard } from '../GlassCard';
import { ViewProps } from 'react-native';

export interface CardProps extends ViewProps {
  children: React.ReactNode;
}

export function Card({ children, ...props }: CardProps) {
  return (
    <GlassCard {...props}>
      {children}
    </GlassCard>
  );
}
