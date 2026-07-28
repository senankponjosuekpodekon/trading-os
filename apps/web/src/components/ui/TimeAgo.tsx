'use client';
import { useEffect, useState } from 'react';

interface TimeAgoProps {
  date: string | Date | number;
  className?: string;
}

function formatAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'à l\'instant';
  if (seconds < 60) return `il y a ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  const [label, setLabel] = useState(formatAgo(new Date(date)));

  useEffect(() => {
    const target = new Date(date);
    setLabel(formatAgo(target));
    const timer = setInterval(() => setLabel(formatAgo(target)), 60_000);
    return () => clearInterval(timer);
  }, [date]);

  return <span className={className}>{label}</span>;
}
