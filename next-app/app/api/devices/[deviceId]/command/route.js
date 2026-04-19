import { NextResponse } from "next/server";
import { getDeviceCommandForHeartbeat } from "../../../../../lib/devices";

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request, { params }) {
  const deviceId = normalizeField(params?.deviceId);
  const { searchParams } = new URL(request.url);
  const deviceSecret = normalizeField(searchParams.get("deviceSecret"));

  if (!deviceId || !deviceSecret) {
    return NextResponse.json({ message: "deviceId and deviceSecret are required" }, { status: 400 });
  }

  const device = await getDeviceCommandForHeartbeat({
    deviceId,
    deviceSecret
  });

  if (!device) {
    return NextResponse.json({ message: "Device authentication failed" }, { status: 401 });
  }

  return NextResponse.json({
    deviceId: device.device_id,
    command: device.led_state || "OFF",
    lastSeenAt: device.last_seen_at,
    status: device.last_status
  });
}
