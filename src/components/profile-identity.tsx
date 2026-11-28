"use client";
import Image from "next/image";
import { useId, useState } from "react";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { LocalClock, areaClassOf } from "./settings-visuals";
const RING =
  "M490.9 415.9A191 191 0 0 1 616.0 360.3L617.6 391.2A160 160 0 0 0 512.9 437.9Z M435.5 564.3A191 191 0 0 1 477.6 430.8L501.7 450.3A160 160 0 0 0 466.4 562.2Z M498.2 692.9A191 191 0 0 1 437.9 584.2L468.4 578.8A160 160 0 0 0 518.9 669.9Z M636.0 360.3A191 191 0 0 1 761.1 415.9L739.1 437.9A160 160 0 0 0 634.4 391.2Z M774.4 430.8A191 191 0 0 1 816.5 564.3L785.6 562.2A160 160 0 0 0 750.3 450.3Z M814.1 584.2A191 191 0 0 1 753.8 692.9L733.1 669.9A160 160 0 0 0 783.6 578.8Z";
const POINTER = "M626 405L641 437H611Z";
const NEEDLE =
  "M480 562Q590 566 626 580Q662 566 772 562Q690 578 660 600Q645 613 641 640L626 712L611 640Q607 613 592 600Q562 578 480 562Z";
/** The Life OS mark: a bronze dial with its needle. */
export function AppLogo({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="416 327 420 420"
      width={size}
      height={size}
      aria-hidden="true"
      className="app-logo"
    >
      <defs>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E9C7A0" />
          <stop offset=".5" stopColor="#A57B56" />
          <stop offset="1" stopColor="#6B4A33" />
        </linearGradient>
        <linearGradient id={`${id}n`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F1D6B8" />
          <stop offset="1" stopColor="#B3875F" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}r)`} d={RING} />
      <path fill={`url(#${id}n)`} d={POINTER} />
      <path fill={`url(#${id}n)`} d={NEEDLE} />
    </svg>
  );
}
export function ProfileAvatar() {
  const { data } = useWorkspace();
  return (
    <span className="avatar">
      {data.profile.avatar_data_url ? (
        <Image
          src={data.profile.avatar_data_url}
          alt="Your profile picture"
          width={40}
          height={40}
          unoptimized
        />
      ) : (
        data.profile.display_name
          ?.split(/\s+/)
          .slice(0, 2)
          .map((x) => x[0])
          .join("")
          .toUpperCase() || "ME"
      )}
    </span>
  );
}
export function ProfilePictureSettings() {
  const { data, request, refresh, notify } = useWorkspace();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(value: string | null) {
    await request("/api/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({
        version: data.profile.version,
        data: {
          display_name: data.profile.display_name,
          theme: data.profile.theme,
          density: data.profile.density,
          avatar_data_url: value,
        },
      }),
    });
    await refresh();
    notify(value ? "Profile picture saved" : "Profile picture removed");
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 8 * 1024 * 1024
      )
        throw Error("Choose a JPEG, PNG or WebP image smaller than 8 MB.");
      const image = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 192;
        canvas.height = 192;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw Error("Image resizing is unavailable in this browser.");
        const side = Math.min(image.width, image.height);
        ctx.drawImage(
          image,
          (image.width - side) / 2,
          (image.height - side) / 2,
          side,
          side,
          0,
          0,
          192,
          192,
        );
        await save(canvas.toDataURL("image/jpeg", 0.8));
      } finally {
        image.close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Picture could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const name = data.profile.display_name?.trim() || "Your profile";
  return (
    <section
      className="panel settings-panel st-nameplate"
      aria-label="Your profile"
    >
      <div className="st-plate">
        <span className="st-plate-photo">
          <ProfileAvatar />
        </span>
        <div>
          <h2>{name}</h2>
          <LocalClock />
          {!!data.areas.length && (
            <ul className="st-area-chips" aria-label="Your life areas">
              {data.areas.map((a) => (
                <li key={a.id} className={`area-${areaClassOf(a.name)}`}>
                  {a.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="small muted">
        Your picture is resized on your device and stored privately with your
        profile.
      </p>
      <div className="briefing-actions">
        <ProfileAvatar />
        <label>
          Choose profile picture
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
        {data.profile.avatar_data_url && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await save(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Removal failed.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove picture
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
