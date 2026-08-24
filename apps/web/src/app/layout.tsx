import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { AppShell } from '@/components/AppShell';
import '@/styles/globals.css';

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'نظام الزيارات — دواء الحياة',
  description: 'تسجيل زيارات المندوبين للأطباء والصيدليات',
  applicationName: 'دواء الحياة',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // المستخدم يجب أن يبقى قادراً على التكبير — منعه يضر بإمكانية الوصول
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#080c15' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={arabic.variable} suppressHydrationWarning>
      <head>
        {/* يطبّق المظهر قبل أول رسم — يمنع وميض الأبيض في الوضع الداكن */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('dv.theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
