"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const intervalId = setInterval(() => {
      router.refresh();
    }, 15000);

    return () => clearInterval(intervalId);
  }, [router]);

  return null;
}
