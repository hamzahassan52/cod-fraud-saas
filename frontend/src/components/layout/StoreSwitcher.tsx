'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/context/StoreContext';
import clsx from 'clsx';

export function StoreSwitcher() {
  const { stores, selectedStore, switchStore } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (stores.length <= 1) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-600 text-[10px] font-bold text-white">
          {selectedStore?.name?.charAt(0)?.toUpperCase() || 'S'}
        </div>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
          {selectedStore?.name || 'My Store'}
        </span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-600 text-[10px] font-bold text-white">
          {selectedStore?.name?.charAt(0)?.toUpperCase() || 'S'}
        </div>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
          {selectedStore?.name || 'Select Store'}
        </span>
        <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {stores.map((store) => (
            <button
              key={store.id}
              onClick={() => { switchStore(store.id); setOpen(false); }}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                selectedStore?.id === store.id
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-700'
              )}
            >
              <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-600 text-[10px] font-bold text-white">
                {store.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-left">
                <p className="font-medium">{store.name}</p>
                <p className="text-xs text-gray-500 dark:text-slate-500 capitalize">{store.platform}</p>
              </div>
              {selectedStore?.id === store.id && (
                <svg className="ml-auto h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
