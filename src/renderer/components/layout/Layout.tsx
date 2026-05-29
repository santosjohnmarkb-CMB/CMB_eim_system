import React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="app-layout flex h-screen overflow-hidden">
      <aside>
        <Sidebar />
      </aside>
      <div className="app-main-col flex-1 flex flex-col min-w-0">
        <header>
          <TopBar />
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
