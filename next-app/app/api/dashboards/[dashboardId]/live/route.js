import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserBySessionToken } from "../../../../../lib/auth";
import { getDashboardForUser } from "../../../../../lib/devices";

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request, { params }) {
  const sessionToken = cookies().get("session_token")?.value;
  const user = await getUserBySessionToken(sessionToken);

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const dashboardId = normalizeField(params?.dashboardId);
  if (!dashboardId) {
    return NextResponse.json({ message: "Dashboard id is required" }, { status: 400 });
  }

  const dashboard = await getDashboardForUser(Number(dashboardId), user.id);
  if (!dashboard) {
    return NextResponse.json({ message: "Dashboard not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    dashboardId: dashboard.id,
    tiles: dashboard.tiles || []
  });
}
