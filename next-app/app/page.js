import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  connectDeviceToUser,
  createDevice,
  getDeviceForUser,
  listDevices,
  listRecentCommands,
  saveCommand
} from "../lib/devices";
import {
  authenticateUser,
  createSession,
  createUser,
  deleteSession,
  getUserBySessionToken
} from "../lib/auth";

function normalizeField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildRedirect(pathname, params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      query.set(key, value);
    }
  });

  const queryString = query.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

async function getCurrentUser() {
  const sessionToken = cookies().get("session_token")?.value;
  return getUserBySessionToken(sessionToken);
}

async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect(buildRedirect("/", { authError: "Please login to connect your Arduino device." }));
  }

  return user;
}

async function registerUser(formData) {
  "use server";

  const fullName = normalizeField(formData.get("fullName"));
  const email = normalizeField(formData.get("email"));
  const password = normalizeField(formData.get("password"));

  if (!fullName || !email || password.length < 6) {
    redirect(
      buildRedirect("/", {
        authError: "Enter your name, email, and a password with at least 6 characters.",
        authView: "register"
      })
    );
  }

  try {
    const user = await createUser({
      fullName,
      email,
      password
    });
    const session = await createSession(user.id);

    cookies().set("session_token", session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: session.expiresAt,
      path: "/"
    });
  } catch (error) {
    redirect(
      buildRedirect("/", {
        authError: "Unable to register. That email may already be in use.",
        authView: "register"
      })
    );
  }

  redirect(buildRedirect("/", { authMessage: "Account created. You can connect your Arduino now." }));
}

async function loginUser(formData) {
  "use server";

  const email = normalizeField(formData.get("email"));
  const password = normalizeField(formData.get("password"));
  const user = await authenticateUser({ email, password });

  if (!user) {
    redirect(buildRedirect("/", { authError: "Invalid email or password." }));
  }

  const session = await createSession(user.id);

  cookies().set("session_token", session.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: session.expiresAt,
    path: "/"
  });

  redirect(buildRedirect("/", { authMessage: "Logged in. Connect your Arduino device below." }));
}

async function logoutUser() {
  "use server";

  const sessionToken = cookies().get("session_token")?.value;

  await deleteSession(sessionToken);
  cookies().delete("session_token");

  redirect(buildRedirect("/", { authMessage: "Logged out." }));
}

async function registerDevice(formData) {
  "use server";

  const user = await requireUser();

  const deviceId = normalizeField(formData.get("deviceId"));
  const deviceName = normalizeField(formData.get("deviceName"));
  const deviceType = normalizeField(formData.get("deviceType")) || "arduino";
  const location = normalizeField(formData.get("location"));

  if (!deviceId || !deviceName) {
    throw new Error("deviceId and deviceName are required");
  }

  try {
    await createDevice({
      deviceId,
      deviceName,
      deviceType,
      location,
      ownerUserId: user.id
    });
  } catch (error) {
    redirect(
      buildRedirect("/", {
        authError: "Unable to register that device. The device ID may already exist."
      })
    );
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { authMessage: `Device ${deviceId} registered.` }));
}

async function connectArduinoDevice(formData) {
  "use server";

  const user = await requireUser();
  const deviceId = normalizeField(formData.get("deviceId"));

  if (!deviceId) {
    redirect(buildRedirect("/", { authError: "Enter the Arduino device ID to connect it." }));
  }

  const connectedDevice = await connectDeviceToUser({
    deviceId,
    userId: user.id
  });

  if (!connectedDevice) {
    redirect(
      buildRedirect("/", {
        authError: "That device was not found, or it already belongs to another user."
      })
    );
  }

  revalidatePath("/");
  redirect(buildRedirect("/", { authMessage: `Arduino device ${deviceId} connected.` }));
}

async function sendDeviceCommand(formData) {
  "use server";

  const user = await requireUser();

  const deviceId = normalizeField(formData.get("deviceId"));
  const command = normalizeField(formData.get("command")).toUpperCase();

  if (!deviceId || !["ON", "OFF"].includes(command)) {
    throw new Error("Valid deviceId and command are required");
  }

  const device = await getDeviceForUser(deviceId, user.id);

  if (!device) {
    redirect(buildRedirect("/", { authError: "You can only control devices connected to your account." }));
  }

  const response = await fetch(
    `http://cpp-api:8080/api/devices/${encodeURIComponent(deviceId)}/commands/${
      command === "ON" ? "on" : "off"
    }`,
    {
      method: "POST",
      cache: "no-store"
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Failed to send device command");
  }

  await saveCommand({
    deviceId,
    command
  });

  revalidatePath("/");
  redirect(buildRedirect("/", { authMessage: `${deviceId} switched ${command}.` }));
}

function formatTopic(deviceId, suffix) {
  return `farm1/${deviceId}/${suffix}`;
}

function maskSecret(secret) {
  if (!secret) {
    return "Not provisioned yet";
  }

  if (secret.length <= 8) {
    return secret;
  }

  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function getDeviceConnectionState(device) {
  if (!device.last_seen_at) {
    return {
      isOnline: false,
      label: "Disconnected",
      subtitle: "No heartbeat received yet"
    };
  }

  const lastSeen = new Date(device.last_seen_at);
  const ageMs = Date.now() - lastSeen.getTime();
  const isOnline = ageMs <= 90 * 1000;

  return {
    isOnline,
    label: isOnline ? "Connected" : "Disconnected",
    subtitle: `Last heartbeat: ${lastSeen.toLocaleString()}`
  };
}

export default async function HomePage({ searchParams }) {
  const user = await getCurrentUser();
  const authMessage = searchParams?.authMessage || "";
  const authError = searchParams?.authError || "";
  const authView = searchParams?.authView || "login";
  const [devices, commands] = user
    ? await Promise.all([listDevices(user.id), listRecentCommands(user.id)])
    : [[], []];
  const onlineCount = devices.filter((device) => getDeviceConnectionState(device).isOnline).length;

  return (
    <main className="page">
      <div className="shell cloudShell">
        {user ? (
          <section className="panel hero">
            <p className="eyebrow">Meenakshi Cloud</p>
            <h1>Your device command center is live.</h1>
            <p>Manage devices, MQTT credentials, and command history from one place.</p>
          </section>
        ) : null}

        <section className="panel stack">
          {authMessage ? <p className="banner bannerSuccess">{authMessage}</p> : null}
          {authError ? <p className="banner bannerError">{authError}</p> : null}

          {!user ? (
            <div className="authCenter">
              <div className="authStage authStageSolo">
                <div className="authCard authCardFeatured">
                  {authView === "register" ? (
                    <>
                      <p className="authKicker">New User</p>
                      <h2>Create your account</h2>
                      <p className="authCopy">
                        Create an account to start managing your Arduino devices from one dashboard.
                      </p>
                      <form action={registerUser} className="authForm">
                        <input className="input" name="fullName" placeholder="Meenakshi" required />
                        <input className="input" name="email" placeholder="meenakshi@example.com" type="email" required />
                        <input className="input" name="password" placeholder="Choose a password" type="password" required />
                        <button className="button buttonOn" type="submit">
                          Register
                        </button>
                      </form>
                      <p className="authFooterLink">
                        Already have an account? <a href="/?authView=login">Login</a>
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="authKicker">Welcome Back</p>
                      <h2>Login</h2>
                      <p className="authCopy">
                        Sign in to manage your Arduino devices, commands, and MQTT credentials.
                      </p>
                      <form action={loginUser} className="authForm">
                        <input className="input" name="email" placeholder="meenakshi@example.com" type="email" required />
                        <input className="input" name="password" placeholder="Your password" type="password" required />
                        <button className="button buttonOff" type="submit">
                          Login
                        </button>
                      </form>
                      <p className="authFooterLink">
                        New user? <a href="/?authView=register">Create an account</a>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="sectionHeader">
                <strong>Welcome, {user.full_name}</strong>
                <form action={logoutUser}>
                  <button className="button buttonGhost" type="submit">
                    Logout
                  </button>
                </form>
              </div>

              <div className="authGrid">
                <div className="historyCard">
                  <strong>Connect Existing Arduino</strong>
                  <p className="empty">
                    Enter the same `DEVICE_ID` used in your Arduino sketch to attach that board to your account.
                  </p>
                  <form action={connectArduinoDevice} className="authForm">
                    <input className="input" name="deviceId" placeholder="arduino-led-01" required />
                    <button className="button buttonOff" type="submit">
                      Connect Device
                    </button>
                  </form>
                </div>

                <div className="historyCard">
                  <strong>Add Arduino Device</strong>
                  <p className="empty">
                    Create a new device record, then copy its MQTT topic into your Arduino sketch.
                  </p>
                  <form action={registerDevice} className="registerForm">
                    <input className="input" name="deviceId" placeholder="arduino-led-02" required />
                    <input className="input" name="deviceName" placeholder="Greenhouse LED" required />
                    <input className="input" name="deviceType" placeholder="arduino" defaultValue="arduino" />
                    <input className="input" name="location" placeholder="Greenhouse Bay A" />
                    <button className="button buttonOn" type="submit">
                      Register Device
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="panel stack">
          <div className="sectionHeader">
            <strong>Your Devices</strong>
            <span className="empty">
              {user ? `${onlineCount}/${devices.length} online` : "Login required"}
            </span>
          </div>

          {!user ? (
            <div className="historyCard">
              <p className="empty">
                Register and login first to connect your Arduino device.
              </p>
            </div>
          ) : devices.length === 0 ? (
            <div className="historyCard">
              <p className="empty">No devices connected yet.</p>
            </div>
          ) : (
            <div className="deviceGrid">
              {devices.map((device) => {
                const connection = getDeviceConnectionState(device);
                return (
                  <article key={device.device_id} className="deviceCard">
                      <div className="deviceTop">
                        <div>
                          <p className="deviceLabel">{device.device_type}</p>
                          <h2>{device.device_name}</h2>
                        </div>
                        <span className="chip">{device.device_id}</span>
                      </div>
                      <div
                        className={`statusBadge ${
                          connection.isOnline ? "statusOnline" : "statusOffline"
                        }`}
                      >
                        <strong>{connection.label}</strong>
                        <span>{connection.subtitle}</span>
                      </div>

                      <p className="empty">
                        {device.location || "No location set"}
                      </p>

                      <div className="topicList">
                        <div className="topicItem">
                          <strong>Command Topic</strong>
                          <code>{formatTopic(device.device_id, "cmd")}</code>
                        </div>
                        <div className="topicItem">
                          <strong>Status Topic</strong>
                          <code>{formatTopic(device.device_id, "status")}</code>
                        </div>
                        <div className="topicItem">
                          <strong>MQTT Username</strong>
                          <code>{device.device_id}</code>
                        </div>
                        <div className="topicItem">
                          <strong>Device Secret</strong>
                          <code>{device.device_secret}</code>
                        </div>
                        <div className="topicItem">
                          <strong>Secret Preview</strong>
                          <code>{maskSecret(device.device_secret)}</code>
                        </div>
                      </div>

                      <div className="controlForm">
                        <form action={sendDeviceCommand}>
                          <input type="hidden" name="deviceId" value={device.device_id} />
                          <input type="hidden" name="command" value="ON" />
                          <button className="button buttonOn" type="submit">
                            Turn On
                          </button>
                        </form>
                        <form action={sendDeviceCommand}>
                          <input type="hidden" name="deviceId" value={device.device_id} />
                          <input type="hidden" name="command" value="OFF" />
                          <button className="button buttonOff" type="submit">
                            Turn Off
                          </button>
                        </form>
                      </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel stack">
          <div className="historyCard">
            <strong>Recent Commands</strong>
            {!user ? (
              <p className="empty">Login to view command history for your devices.</p>
            ) : commands.length === 0 ? (
              <p className="empty">No commands have been sent yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Device</th>
                    <th>Command</th>
                    <th>Source</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {commands.map((command) => (
                    <tr key={command.id}>
                      <td>{command.id}</td>
                      <td>{command.device_id}</td>
                      <td>{command.command}</td>
                      <td>{command.source}</td>
                      <td>{new Date(command.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
