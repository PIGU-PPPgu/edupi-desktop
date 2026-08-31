import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";

import { I18nProvider } from "@/hooks/useI18n";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider initialLocale="zh-CN">
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
