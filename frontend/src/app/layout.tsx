import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/context/ThemeProvider';
import { StoreProvider } from '@/context/StoreContext';
import { ScanHistoryProvider } from '@/context/scan-history-context';

export const metadata: Metadata = {
  title: 'COD Fraud Shield - Revenue Protection Control Center',
  description: 'COD Fraud Detection & Risk Scoring System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <StoreProvider>
            <ScanHistoryProvider>
              {children}
            </ScanHistoryProvider>
          </StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
