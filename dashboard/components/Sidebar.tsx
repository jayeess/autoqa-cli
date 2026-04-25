'use client';

/**
 * Dashboard sidebar navigation.
 *
 * Runs as a client component so the active route can be highlighted
 * via `usePathname`. Nav items are statically defined — adding a new
 * view only requires adding a row here and a matching route folder
 * under `app/`.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ClipboardList,
  Bug,
  Activity,
  Code2,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface NavItem {
  label: string;
  href: string;
  icon: IconType;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { label: 'Command Center', href: '/', icon: LayoutDashboard },
  { label: 'Test Matrices', href: '/matrices', icon: ClipboardList, disabled: true },
  { label: 'Bug Reports', href: '/bugs', icon: Bug, disabled: true },
  { label: 'Activity', href: '/activity', icon: Activity, disabled: true },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 backdrop-blur lg:flex">
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-950 font-black">
          A
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight text-slate-100">
            AutoQA
          </span>
          <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
            Dashboard
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-6">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          const classes = [
            'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive
              ? 'bg-slate-800/80 text-emerald-300'
              : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100',
            item.disabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : '',
          ]
            .filter(Boolean)
            .join(' ');

          if (item.disabled) {
            return (
              <div key={item.href} className={classes} aria-disabled="true">
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                <span className="ml-auto rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                  soon
                </span>
              </div>
            );
          }

          return (
            <Link key={item.href} href={item.href} className={classes}>
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 px-6 py-4">
        <a
          href="https://github.com/jayeess/autoqa-cli"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs font-medium text-slate-500 transition-colors hover:text-slate-200"
        >
          <Code2 className="h-3.5 w-3.5" />
          github.com/jayeess/autoqa-cli
        </a>
      </div>
    </aside>
  );
}
