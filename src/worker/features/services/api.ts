import { HttpError, router } from "../../shared/http.ts";

/** AdGuard's blocked-services registry, the same source AdGuard Home and AdGuard DNS use */
export const SERVICES_URL = "https://adguardteam.github.io/HostlistsRegistry/assets/services.json";

/**
 * AdGuard's registry is mostly services outside mainland China. These come from the per-app rule
 * sets of blackmatrix7/ios_rule_script (GPL-2.0), downloaded at runtime and never bundled
 */
export const COMMUNITY_RULES_URL = "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash";

const DOMESTIC: { id: string; name: string; group: string; dir: string }[] = [
  { id: "douyin", name: "抖音", group: "social_network", dir: "DouYin" },
  { id: "kuaishou", name: "快手", group: "social_network", dir: "KuaiShou" },
  { id: "baidu_tieba", name: "百度贴吧", group: "social_network", dir: "BaiDuTieBa" },
  { id: "pinduoduo", name: "拼多多", group: "shopping", dir: "Pinduoduo" },
  { id: "jd", name: "京东", group: "shopping", dir: "JingDong" },
  { id: "meituan", name: "美团", group: "shopping", dir: "MeiTuan" },
  { id: "youku", name: "优酷", group: "streaming", dir: "Youku" },
  { id: "tencent_video", name: "腾讯视频", group: "streaming", dir: "TencentVideo" },
  { id: "mango_tv", name: "芒果TV", group: "streaming", dir: "HunanTV" },
  { id: "netease_music", name: "网易云音乐", group: "streaming", dir: "NetEaseMusic" },
  { id: "kugou_kuwo", name: "酷狗 / 酷我", group: "streaming", dir: "KugouKuwo" },
  { id: "huya", name: "虎牙", group: "streaming", dir: "HuYa" },
  { id: "douyu", name: "斗鱼", group: "streaming", dir: "Douyu" },
  { id: "hoyoverse", name: "米哈游", group: "gaming", dir: "HoYoverse" },
];

const CACHE = { cacheTtl: 3600, cacheEverything: true };

interface RegistryService {
  id: string;
  name: string;
  rules: string[];
  icon_svg?: string;
  group?: string;
}

export interface Service {
  id: string;
  name: string;
  group: string;
  /** SVG markup; empty for community services */
  icon: string;
  rules: string[];
}

export const servicesApi = router();

/**
 * Every service with its rules, which the browser compiles into the snapshot as one list each.
 * A source that cannot be fetched is left out; only when nothing at all loads is it an error
 */
servicesApi.get("/", async (c) => {
  const [registry, domestic] = await Promise.all([registryServices(), Promise.all(DOMESTIC.map(communityService))]);
  const services = [...(registry ?? []), ...domestic.filter((s): s is Service => s !== undefined)];
  if (services.length === 0) throw new HttpError(502, "no blocked-services source could be fetched");
  return c.json(services, 200, { "cache-control": "private, max-age=600" });
});

async function registryServices(): Promise<Service[] | undefined> {
  try {
    const res = await fetch(SERVICES_URL, { cf: CACHE });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { blocked_services: services } = await res.json<{ blocked_services?: RegistryService[] }>();
    if (!Array.isArray(services)) throw new Error("unexpected shape");
    return services
      .filter((s) => typeof s.id === "string" && /^[a-z0-9_]{1,64}$/.test(s.id) && Array.isArray(s.rules))
      .map((s) => ({ id: s.id, name: s.name, group: s.group ?? "other", icon: s.icon_svg ?? "", rules: s.rules }));
  } catch (err) {
    console.warn("AdGuard services registry unavailable", String(err));
    return undefined;
  }
}

async function communityService(entry: (typeof DOMESTIC)[number]): Promise<Service | undefined> {
  try {
    const res = await fetch(`${COMMUNITY_RULES_URL}/${entry.dir}/${entry.dir}.list`, { cf: CACHE });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rules = clashToAdblock(await res.text());
    return rules.length > 0 ? { id: entry.id, name: entry.name, group: entry.group, icon: "", rules } : undefined;
  } catch (err) {
    console.warn("community rule set unavailable", { dir: entry.dir, error: String(err) });
    return undefined;
  }
}

/**
 * Clash rule lists: `DOMAIN,a.com` matches the name only and `DOMAIN-SUFFIX,a.com` its subdomains
 * too. Keyword, IP and process rules have no exact DNS equivalent and are skipped
 */
export function clashToAdblock(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [kind, value] = line.trim().split(",", 2);
    if (!value) continue;
    if (kind === "DOMAIN") out.push(`|${value.trim()}^`);
    else if (kind === "DOMAIN-SUFFIX") out.push(`||${value.trim()}^`);
  }
  return out;
}
