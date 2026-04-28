import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserBySessionToken } from "../../../../../lib/auth";
import { getDashboardForUser, setDashboardTileVariableValueForUser } from "../../../../../lib/devices";

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getCppApiUrl() {
  return (process.env.CPP_API_URL || "http://localhost:8080").replace(/\/+$/, "");
}

async function publishLedCommandWithCppApi({ deviceId, command }) {
  const commandPath = command === "ON" ? "on" : "off";
  const response = await fetch(
    `${getCppApiUrl()}/api/devices/${encodeURIComponent(deviceId)}/commands/${commandPath}`,
    {
      method: "POST",
      cache: "no-store"
    }
  );

  if (!response.ok) {
    let message = "C++ API could not publish the LED command.";
    try {
      const body = await response.json();
      message = body?.message || message;
    } catch (error) {
      message = `${message} HTTP ${response.status}`;
    }

    throw new Error(message);
  }
}

export async function POST(request, { params }) {
  const sessionToken = cookies().get("session_token")?.value;
  const user = await getUserBySessionToken(sessionToken);

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const tileId = normalizeField(params?.tileId);
  if (!tileId) {
    return NextResponse.json({ message: "Tile id is required" }, { status: 400 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const dashboardId = normalizeField(String(body?.dashboardId || ""));
  const nextValue = body?.nextValue === true;

  if (!dashboardId) {
    return NextResponse.json({ message: "Dashboard id is required" }, { status: 400 });
  }

  const dashboard = await getDashboardForUser(Number(dashboardId), user.id);
  const tile = dashboard?.tiles?.find((item) => String(item.id) === tileId) || null;

  if (!dashboard || !tile) {
    return NextResponse.json({ message: "Linked switch not found." }, { status: 404 });
  }

  if (tile.device_id && Number(tile.pin_number || 13) === 13) {
    await publishLedCommandWithCppApi({
      deviceId: tile.device_id,
      command: nextValue ? "ON" : "OFF"
    });
  }

  const updated = await setDashboardTileVariableValueForUser({
    dashboardId: Number(dashboardId),
    tileId: Number(tileId),
    userId: user.id,
    value: nextValue
  });

  if (!updated) {
    return NextResponse.json({ message: "Unable to update switch." }, { status: 404 });
  }

  revalidatePath("/");

  return NextResponse.json({
    ok: true,
    tileId: Number(tileId),
    currentValue: updated.current_value
  });
}
