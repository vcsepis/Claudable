import './globals.css'
import 'highlight.js/styles/github-dark.css'
import GlobalSettingsProvider from '@/contexts/GlobalSettingsContext'
import { AuthProvider } from '@/contexts/AuthContext'
import Header from '@/components/layout/Header'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'monmi',
  description: 'monmi Application',
  icons: {
    icon: 'https://monmi.au/assets/monmi-logo-qBVbzZlt.jpg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <head />
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <AuthProvider>
          <GlobalSettingsProvider>
            <Header />
            <main>{children}</main>
          </GlobalSettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
