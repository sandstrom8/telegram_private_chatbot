// Cloudflare Worker：Telegram 双向机器人 v5.7 (双向动画回执版)

// --- 配置常量 ---
const CONFIG = {
    VERIFY_ID_LENGTH: 12,
    VERIFY_EXPIRE_SECONDS: 300,         // 5分钟
    VERIFIED_EXPIRE_SECONDS: 2592000,   // 30天
    MEDIA_GROUP_EXPIRE_SECONDS: 60,
    MEDIA_GROUP_DELAY_MS: 3000,         // 3秒
    PENDING_MAX_MESSAGES: 10,           // 验证期间最多暂存的消息数
    ADMIN_CACHE_TTL_SECONDS: 300,       // 管理员权限缓存 5 分钟
    NEEDS_REVERIFY_TTL_SECONDS: 600,    // 标记需重新验证的 TTL
    RATE_LIMIT_MESSAGE: 45,
    RATE_LIMIT_VERIFY: 3,
    RATE_LIMIT_WINDOW: 60,
    BUTTON_COLUMNS: 2,
    MAX_TITLE_LENGTH: 128,
    MAX_NAME_LENGTH: 30,
    API_TIMEOUT_MS: 10000,
    CLEANUP_BATCH_SIZE: 10,
    MAX_CLEANUP_DISPLAY: 20,
    CLEANUP_LOCK_TTL_SECONDS: 1800,     // /cleanup 防并发锁 30 分钟
    MAX_RETRY_ATTEMPTS: 3,
    THREAD_HEALTH_TTL_MS: 60000
};

// 线程健康检查缓存，减少频繁探测请求
const threadHealthCache = new Map();
// 同一实例内的并发保护
const topicCreateInFlight = new Map();
// 管理员权限缓存
const adminStatusCache = new Map();

// --- 本地题库 (50条扩充版：零延迟、防死锁、极速响应) ---
const LOCAL_QUESTIONS = [
    // 基础数学
    {"question": "1 加 1 等于几？", "correct_answer": "2", "incorrect_answers": ["1", "3", "0"]},
    {"question": "5 减 3 等于几？", "correct_answer": "2", "incorrect_answers": ["1", "3", "4"]},
    {"question": "2 乘以 4 等于几？", "correct_answer": "8", "incorrect_answers": ["6", "10", "4"]},
    {"question": "10 除以 2 等于几？", "correct_answer": "5", "incorrect_answers": ["4", "2", "8"]},
    {"question": "3 加 4 等于几？", "correct_answer": "7", "incorrect_answers": ["6", "8", "9"]},
    {"question": "9 减 4 等于几？", "correct_answer": "5", "incorrect_answers": ["4", "6", "3"]},
    {"question": "5 乘以 5 等于几？", "correct_answer": "25", "incorrect_answers": ["20", "30", "15"]},
    {"question": "10 加 10 等于几？", "correct_answer": "20", "incorrect_answers": ["10", "100", "0"]},
    
    // 自然常识
    {"question": "冰融化后会变成什么？", "correct_answer": "水", "incorrect_answers": ["石头", "木头", "火"]},
    {"question": "水沸腾时会产生什么？", "correct_answer": "水蒸气", "incorrect_answers": ["冰块", "泥土", "火焰"]},
    {"question": "晴朗的天空通常是什么颜色的？", "correct_answer": "蓝色", "incorrect_answers": ["绿色", "红色", "紫色"]},
    {"question": "太阳从哪个方向升起？", "correct_answer": "东方", "incorrect_answers": ["西方", "南方", "北方"]},
    {"question": "太阳从哪个方向落下？", "correct_answer": "西方", "incorrect_answers": ["东方", "南方", "北方"]},
    {"question": "植物生长主要需要水分和什么？", "correct_answer": "阳光", "incorrect_answers": ["汽油", "塑料", "黄金"]},
    {"question": "一年有几个季节？", "correct_answer": "4个", "incorrect_answers": ["2个", "6个", "12个"]},
    {"question": "下雨天我们通常需要打什么？", "correct_answer": "雨伞", "incorrect_answers": ["手电筒", "扇子", "领带"]},
    
    // 动物常识
    {"question": "小狗发出的叫声通常是？", "correct_answer": "汪汪", "incorrect_answers": ["喵喵", "咩咩", "呱呱"]},
    {"question": "小猫发出的叫声通常是？", "correct_answer": "喵喵", "incorrect_answers": ["汪汪", "哞哞", "叽叽"]},
    {"question": "鱼通常生活在哪里？", "correct_answer": "水里", "incorrect_answers": ["树上", "土里", "火里"]},
    {"question": "哪种动物的脖子特别长？", "correct_answer": "长颈鹿", "incorrect_answers": ["大象", "兔子", "老虎"]},
    {"question": "大象最显著的特征是有长长的什么？", "correct_answer": "鼻子", "incorrect_answers": ["尾巴", "耳朵", "爪子"]},
    {"question": "企鹅主要生活在非常冷还是非常热的地方？", "correct_answer": "非常冷", "incorrect_answers": ["非常热", "温水里", "沙漠里"]},
    {"question": "能在天上飞的动物通常长有什么？", "correct_answer": "翅膀", "incorrect_answers": ["鳃", "鳞片", "犄角"]},
    {"question": "蜜蜂通常会采什么来酿蜜？", "correct_answer": "花蜜", "incorrect_answers": ["树叶", "泥土", "石头"]},
    {"question": "青蛙在变成青蛙之前叫什么？", "correct_answer": "蝌蚪", "incorrect_answers": ["毛毛虫", "蚕宝宝", "小鱼"]},
    {"question": "晚上会发光的小飞虫叫什么？", "correct_answer": "萤火虫", "incorrect_answers": ["苍蝇", "蚊子", "蝴蝶"]},

    // 时间与生活常识
    {"question": "一天有多少个小时？", "correct_answer": "24小时", "incorrect_answers": ["12小时", "48小时", "100小时"]},
    {"question": "一小时有多少分钟？", "correct_answer": "60分钟", "incorrect_answers": ["30分钟", "100分钟", "24分钟"]},
    {"question": "一年有几个月？", "correct_answer": "12个", "incorrect_answers": ["10个", "365个", "4个"]},
    {"question": "星期一的后面是星期几？", "correct_answer": "星期二", "incorrect_answers": ["星期日", "星期五", "星期三"]},
    {"question": "正常人有几只眼睛？", "correct_answer": "2只", "incorrect_answers": ["1只", "3只", "4只"]},
    {"question": "我们用什么器官来听声音？", "correct_answer": "耳朵", "incorrect_answers": ["眼睛", "鼻子", "嘴巴"]},
    {"question": "我们用什么器官来看东西？", "correct_answer": "眼睛", "incorrect_answers": ["耳朵", "鼻子", "嘴巴"]},
    {"question": "我们用什么器官来闻气味？", "correct_answer": "鼻子", "incorrect_answers": ["眼睛", "耳朵", "嘴巴"]},
    {"question": "红绿灯中，什么颜色代表“停止”？", "correct_answer": "红色", "incorrect_answers": ["绿色", "黄色", "蓝色"]},
    {"question": "红绿灯中，什么颜色代表“通行”？", "correct_answer": "绿色", "incorrect_answers": ["红色", "黄色", "黑色"]},

    // 物品分类常识
    {"question": "以下哪个属于水果？", "correct_answer": "香蕉", "incorrect_answers": ["白菜", "猪肉", "大米"]},
    {"question": "以下哪个属于交通工具？", "correct_answer": "汽车", "incorrect_answers": ["苹果", "电视", "铅笔"]},
    {"question": "以下哪个是用来写字的？", "correct_answer": "笔", "incorrect_answers": ["勺子", "梳子", "筷子"]},
    {"question": "以下哪个是用来吃饭的？", "correct_answer": "筷子", "incorrect_answers": ["毛笔", "梳子", "扫把"]},
    {"question": "以下哪个属于电器？", "correct_answer": "电视机", "incorrect_answers": ["木桌", "石头", "皮鞋"]},
    {"question": "书主要是由什么材质做的？", "correct_answer": "纸张", "incorrect_answers": ["钢铁", "玻璃", "泥土"]},
    {"question": "衣服穿脏了通常需要用什么洗？", "correct_answer": "洗衣机/洗衣液", "incorrect_answers": ["冰箱", "微波炉", "洗碗机"]},
    {"question": "切菜通常需要使用什么工具？", "correct_answer": "菜刀", "incorrect_answers": ["锤子", "剪刀", "扳手"]},
    {"question": "用来遮挡阳光保护眼睛的眼镜叫什么？", "correct_answer": "墨镜", "incorrect_answers": ["老花镜", "近视镜", "放大镜"]},
    {"question": "睡觉时通常垫在头下的物品叫什么？", "correct_answer": "枕头", "incorrect_answers": ["被子", "床单", "地毯"]},
    {"question": "以下哪种材料通常是透明的？", "correct_answer": "玻璃", "incorrect_answers": ["木板", "砖头", "铁板"]},
    {"question": "用来测量温度的仪器叫什么？", "correct_answer": "温度计", "incorrect_answers": ["尺子", "指南针", "天平"]},
    {"question": "哪种乐器通常有黑白相间的琴键？", "correct_answer": "钢琴", "incorrect_answers": ["吉他", "小提琴", "鼓"]},
    {"question": "刷牙时除了牙刷还需要什么？", "correct_answer": "牙膏", "incorrect_answers": ["洗发水", "沐浴露", "洗面奶"]}
];

// --- 辅助工具函数 ---

const Logger = {
    info(action, data = {}) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'INFO', action, ...data })); },
    warn(action, data = {}) { console.warn(JSON.stringify({ timestamp: new Date().toISOString(), level: 'WARN', action, ...data })); },
    error(action, error, data = {}) { console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', action, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, ...data })); },
    debug(action, data = {}) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'DEBUG', action, ...data })); }
};

function secureRandomInt(min, max) {
    const range = max - min;
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return min + (bytes[0] % range);
}

function secureRandomId(length = 12) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

async function safeGetJSON(env, key, defaultValue = null) {
    try {
        const data = await env.TOPIC_MAP.get(key, { type: "json" });
        if (data === null || data === undefined) return defaultValue;
        if (typeof data !== 'object') { Logger.warn('kv_invalid_type', { key, type: typeof data }); return defaultValue; }
        return data;
    } catch (e) {
        return defaultValue;
    }
}

function normalizeTgDescription(description) { return (description || "").toString().toLowerCase(); }

function isTopicMissingOrDeleted(description) {
    const desc = normalizeTgDescription(description);
    return desc.includes("thread not found") || desc.includes("topic not found") || desc.includes("message thread not found") || desc.includes("topic deleted") || desc.includes("thread deleted") || desc.includes("forum topic not found") || desc.includes("topic closed permanently");
}

function isTestMessageInvalid(description) {
    const desc = normalizeTgDescription(description);
    return desc.includes("message text is empty") || desc.includes("bad request: message text is empty");
}

async function getOrCreateUserTopicRec(from, key, env, userId) {
    const existing = await safeGetJSON(env, key, null);
    if (existing && existing.thread_id) return existing;

    const inflight = topicCreateInFlight.get(String(userId));
    if (inflight) return await inflight;

    const p = (async () => {
        const again = await safeGetJSON(env, key, null);
        if (again && again.thread_id) return again;
        return await createTopic(from, key, env, userId);
    })();

    topicCreateInFlight.set(String(userId), p);
    try {
        return await p;
    } finally {
        if (topicCreateInFlight.get(String(userId)) === p) topicCreateInFlight.delete(String(userId));
    }
}

function withMessageThreadId(body, threadId) {
    if (threadId === undefined || threadId === null) return body;
    return { ...body, message_thread_id: threadId };
}

async function probeForumThread(env, expectedThreadId, { userId, reason, doubleCheckOnMissingThreadId = true } = {}) {
    const attemptOnce = async () => {
        const res = await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: expectedThreadId, text: "🔎" });
        const actualThreadId = res.result?.message_thread_id;
        const probeMessageId = res.result?.message_id;

        if (res.ok && probeMessageId) {
            try { await tgCall(env, "deleteMessage", { chat_id: env.SUPERGROUP_ID, message_id: probeMessageId }); } catch (e) {}
        }

        if (!res.ok) {
            if (isTopicMissingOrDeleted(res.description)) return { status: "missing", description: res.description };
            if (isTestMessageInvalid(res.description)) return { status: "probe_invalid", description: res.description };
            return { status: "unknown_error", description: res.description };
        }

        if (actualThreadId === undefined || actualThreadId === null) return { status: "missing_thread_id" };
        if (Number(actualThreadId) !== Number(expectedThreadId)) return { status: "redirected", actualThreadId };
        return { status: "ok" };
    };

    const first = await attemptOnce();
    if (first.status !== "missing_thread_id" || !doubleCheckOnMissingThreadId) return first;

    const second = await attemptOnce();
    return second;
}

async function resetUserVerificationAndRequireReverify(env, { userId, userKey, oldThreadId, pendingMsgId, reason }) {
    await env.TOPIC_MAP.delete(`verified:${userId}`);
    await env.TOPIC_MAP.put(`needs_verify:${userId}`, "1", { expirationTtl: CONFIG.NEEDS_REVERIFY_TTL_SECONDS });
    await env.TOPIC_MAP.delete(`retry:${userId}`);
    if (userKey) await env.TOPIC_MAP.delete(userKey);
    if (oldThreadId !== undefined && oldThreadId !== null) {
        await env.TOPIC_MAP.delete(`thread:${oldThreadId}`);
        await env.TOPIC_MAP.delete(`thread_ok:${oldThreadId}`);
        threadHealthCache.delete(oldThreadId);
    }
    await sendVerificationChallenge(userId, env, pendingMsgId || null);
}

function parseAdminIdAllowlist(env) {
    const raw = (env.ADMIN_IDS || "").toString().trim();
    if (!raw) return null;
    const ids = raw.split(/[,;\s]+/g).map(s => s.trim()).filter(Boolean);
    const set = new Set();
    for (const id of ids) {
        const n = Number(id);
        if (!Number.isFinite(n)) continue;
        set.add(String(n));
    }
    return set.size > 0 ? set : null;
}

async function isAdminUser(env, userId) {
    const allowlist = parseAdminIdAllowlist(env);
    if (allowlist && allowlist.has(String(userId))) return true;

    const cacheKey = String(userId);
    const now = Date.now();
    const cached = adminStatusCache.get(cacheKey);
    if (cached && (now - cached.ts < CONFIG.ADMIN_CACHE_TTL_SECONDS * 1000)) return cached.isAdmin;

    const kvKey = `admin:${userId}`;
    const kvVal = await env.TOPIC_MAP.get(kvKey);
    if (kvVal === "1" || kvVal === "0") {
        const isAdmin = kvVal === "1";
        adminStatusCache.set(cacheKey, { ts: now, isAdmin });
        return isAdmin;
    }

    try {
        const res = await tgCall(env, "getChatMember", { chat_id: env.SUPERGROUP_ID, user_id: userId });
        const status = res.result?.status;
        const isAdmin = res.ok && (status === "creator" || status === "administrator");
        await env.TOPIC_MAP.put(kvKey, isAdmin ? "1" : "0", { expirationTtl: CONFIG.ADMIN_CACHE_TTL_SECONDS });
        adminStatusCache.set(cacheKey, { ts: now, isAdmin });
        return isAdmin;
    } catch (e) {
        return false;
    }
}

async function getAllKeys(env, prefix) {
    const allKeys = [];
    let cursor = undefined;
    do {
        const result = await env.TOPIC_MAP.list({ prefix, cursor });
        allKeys.push(...result.keys);
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);
    return allKeys;
}

function shuffleArray(arr) {
    const array = [...arr];
    for (let i = array.length - 1; i > 0; i--) {
        const j = secureRandomInt(0, i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function checkRateLimit(userId, env, action = 'message', limit = 20, window = 60) {
    const key = `ratelimit:${action}:${userId}`;
    const countStr = await env.TOPIC_MAP.get(key);
    const count = parseInt(countStr || "0");

    if (count >= limit) return { allowed: false, remaining: 0 };
    await env.TOPIC_MAP.put(key, String(count + 1), { expirationTtl: window });
    return { allowed: true, remaining: limit - count - 1 };
}

// 【动态表态反馈】支持传入自定义表情，区分用户和管理员
async function sendSuccessReaction(env, chatId, messageId, emojiIcon = "🦄") {
    try {
        await tgCall(env, "setMessageReaction", {
            chat_id: chatId,
            message_id: messageId,
            reaction: [{ type: "emoji", emoji: emojiIcon }] 
        });
    } catch (e) {
        // 如果客户端过老不支持，静默跳过
    }
}

export default {
  async fetch(request, env, ctx) {
    if (!env.TOPIC_MAP) return new Response("Error: KV 'TOPIC_MAP' not bound.");
    if (!env.BOT_TOKEN) return new Response("Error: BOT_TOKEN not set.");
    if (!env.SUPERGROUP_ID) return new Response("Error: SUPERGROUP_ID not set.");

    const normalizedEnv = {
        ...env,
        SUPERGROUP_ID: String(env.SUPERGROUP_ID),
        BOT_TOKEN: String(env.BOT_TOKEN)
    };

    if (!normalizedEnv.SUPERGROUP_ID.startsWith("-100")) return new Response("Error: SUPERGROUP_ID must start with -100");
    if (request.method !== "POST") return new Response("OK");

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return new Response("OK");

    let update;
    try {
      update = await request.json();
      if (!update || typeof update !== 'object') return new Response("OK");
    } catch (e) {
      return new Response("OK");
    }

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, normalizedEnv, ctx);
      return new Response("OK");
    }

    const msg = update.message;
    if (!msg) return new Response("OK");

    ctx.waitUntil(flushExpiredMediaGroups(normalizedEnv, Date.now()));

    if (msg.chat && msg.chat.type === "private") {
      try {
        await handlePrivateMessage(msg, normalizedEnv, ctx);
      } catch (e) {
        await tgCall(normalizedEnv, "sendMessage", { chat_id: msg.chat.id, text: `⚠️ 系统繁忙，请稍后再试。` });
      }
      return new Response("OK");
    }

    if (msg.chat && String(msg.chat.id) === normalizedEnv.SUPERGROUP_ID) {
        if (msg.forum_topic_closed && msg.message_thread_id) {
            await updateThreadStatus(msg.message_thread_id, true, normalizedEnv);
            return new Response("OK");
        }
        if (msg.forum_topic_reopened && msg.message_thread_id) {
            await updateThreadStatus(msg.message_thread_id, false, normalizedEnv);
            return new Response("OK");
        }
        const text = (msg.text || "").trim();
        const isCommand = !!text && text.startsWith("/");
        if (msg.message_thread_id || isCommand) {
            await handleAdminReply(msg, normalizedEnv, ctx);
            return new Response("OK");
        }
    }

    return new Response("OK");
  },
};

// ---------------- 核心业务逻辑 ----------------

async function handlePrivateMessage(msg, env, ctx) {
  const userId = msg.chat.id;
  const key = `user:${userId}`;

  const rateLimit = await checkRateLimit(userId, env, 'message', CONFIG.RATE_LIMIT_MESSAGE, CONFIG.RATE_LIMIT_WINDOW);
  if (!rateLimit.allowed) {
      await tgCall(env, "sendMessage", { chat_id: userId, text: "⚠️ 发送过于频繁，请稍后再试。" });
      return;
  }

  if (msg.text && msg.text.startsWith("/") && msg.text.trim() !== "/start") return;

  const isBanned = await env.TOPIC_MAP.get(`banned:${userId}`);
  if (isBanned) return;

  const verified = await env.TOPIC_MAP.get(`verified:${userId}`);
  const isStart = msg.text && msg.text.trim() === "/start";

  if (!verified) {
    const pendingMsgId = isStart ? null : msg.message_id;
    await sendVerificationChallenge(userId, env, pendingMsgId);
    return;
  }

  if (isStart) {
      const welcomeText = `👋 **欢迎使用 Sandstorm 专属传话筒**\n\n您已通过验证，现在可以自由与我对话。我会将您的消息原封不动地转达给管理员。\n\n💡 **使用说明：**\n• 直接发送文本、图片、视频或文件即可。\n• 请文明用语，耐心等待回复。\n• 消息送达后右下角会闪烁 🦄 星光图标提示。`;
      await tgCall(env, "sendMessage", {
          chat_id: userId,
          text: welcomeText,
          parse_mode: "Markdown"
      });
      return;
  }

  await forwardToTopic(msg, userId, key, env, ctx);
}

async function forwardToTopic(msg, userId, key, env, ctx) {
    const needsVerify = await env.TOPIC_MAP.get(`needs_verify:${userId}`);
    if (needsVerify) {
        await sendVerificationChallenge(userId, env, msg.message_id || null);
        return;
    }

    let rec = await safeGetJSON(env, key, null);

    if (rec && rec.closed) {
        await tgCall(env, "sendMessage", { chat_id: userId, text: "🚫 当前对话已被管理员关闭。" });
        return;
    }

    const retryKey = `retry:${userId}`;
    let retryCount = parseInt(await env.TOPIC_MAP.get(retryKey) || "0");

    if (retryCount > CONFIG.MAX_RETRY_ATTEMPTS) {
        await tgCall(env, "sendMessage", { chat_id: userId, text: "❌ 系统繁忙，请稍后再试。" });
        await env.TOPIC_MAP.delete(retryKey);
        return;
    }

    if (!rec || !rec.thread_id) {
        rec = await getOrCreateUserTopicRec(msg.from, key, env, userId);
        if (!rec || !rec.thread_id) throw new Error("创建话题失败");
    }

    if (rec && rec.thread_id) {
        const mappedUser = await env.TOPIC_MAP.get(`thread:${rec.thread_id}`);
        if (!mappedUser) await env.TOPIC_MAP.put(`thread:${rec.thread_id}`, String(userId));
    }

    if (rec && rec.thread_id) {
        const cacheKey = rec.thread_id;
        const now = Date.now();
        const cached = threadHealthCache.get(cacheKey);
        const withinTTL = cached && (now - cached.ts < CONFIG.THREAD_HEALTH_TTL_MS);

        if (!withinTTL) {
            const kvHealthKey = `thread_ok:${rec.thread_id}`;
            const kvHealthOk = await env.TOPIC_MAP.get(kvHealthKey);
            if (kvHealthOk === "1") {
                threadHealthCache.set(cacheKey, { ts: now, ok: true });
            } else {
                const probe = await probeForumThread(env, rec.thread_id, { userId, reason: "health_check" });
                if (probe.status === "redirected" || probe.status === "missing" || probe.status === "missing_thread_id") {
                    await resetUserVerificationAndRequireReverify(env, { userId, userKey: key, oldThreadId: rec.thread_id, pendingMsgId: msg.message_id, reason: `health_check:${probe.status}` });
                    return;
                } else if (probe.status === "probe_invalid") {
                    threadHealthCache.set(cacheKey, { ts: now, ok: true });
                    await env.TOPIC_MAP.put(kvHealthKey, "1", { expirationTtl: Math.ceil(CONFIG.THREAD_HEALTH_TTL_MS / 1000) });
                } else {
                    await env.TOPIC_MAP.delete(retryKey);
                    threadHealthCache.set(cacheKey, { ts: now, ok: true });
                    await env.TOPIC_MAP.put(kvHealthKey, "1", { expirationTtl: Math.ceil(CONFIG.THREAD_HEALTH_TTL_MS / 1000) });
                }
            }
        }
    }

    if (msg.media_group_id) {
        await handleMediaGroup(msg, env, ctx, {
            direction: "p2t",
            targetChat: env.SUPERGROUP_ID,
            threadId: rec.thread_id
        });
        return; 
    }

    const res = await tgCall(env, "forwardMessage", {
        chat_id: env.SUPERGROUP_ID,
        from_chat_id: userId,
        message_id: msg.message_id,
        message_thread_id: rec.thread_id,
    });

    const resThreadId = res.result?.message_thread_id;
    if (res.ok && resThreadId !== undefined && resThreadId !== null && Number(resThreadId) !== Number(rec.thread_id)) {
        if (res.result?.message_id) {
            try { await tgCall(env, "deleteMessage", { chat_id: env.SUPERGROUP_ID, message_id: res.result.message_id }); } catch (e) {}
        }
        await resetUserVerificationAndRequireReverify(env, { userId, userKey: key, oldThreadId: rec.thread_id, pendingMsgId: msg.message_id, reason: "forward_redirected_to_general" });
        return;
    }

    if (res.ok && (resThreadId === undefined || resThreadId === null)) {
        const probe = await probeForumThread(env, rec.thread_id, { userId, reason: "forward_result_missing_thread_id" });
        if (probe.status !== "ok") {
            if (res.result?.message_id) {
                try { await tgCall(env, "deleteMessage", { chat_id: env.SUPERGROUP_ID, message_id: res.result.message_id }); } catch (e) {}
            }
            await resetUserVerificationAndRequireReverify(env, { userId, userKey: key, oldThreadId: rec.thread_id, pendingMsgId: msg.message_id, reason: `forward_missing_thread_id:${probe.status}` });
            return;
        }
    }

    if (!res.ok) {
        const desc = normalizeTgDescription(res.description);
        if (isTopicMissingOrDeleted(desc)) {
            await resetUserVerificationAndRequireReverify(env, { userId, userKey: key, oldThreadId: rec.thread_id, pendingMsgId: msg.message_id, reason: "forward_failed_topic_missing" });
            return;
        }
        if (desc.includes("chat not found")) throw new Error(`群组ID错误: ${env.SUPERGROUP_ID}`);
        if (desc.includes("not enough rights")) throw new Error("机器人权限不足 (需 Manage Topics)");

        await tgCall(env, "copyMessage", {
            chat_id: env.SUPERGROUP_ID,
            from_chat_id: userId,
            message_id: msg.message_id,
            message_thread_id: rec.thread_id
        });
    }

    // 【新增补齐】用户发送给群组，亮起独角兽 🦄
    await sendSuccessReaction(env, userId, msg.message_id, "🦄");
}

async function handleAdminReply(msg, env, ctx) {
  const threadId = msg.message_thread_id;
  const text = (msg.text || "").trim();
  const senderId = msg.from?.id;

  if (!senderId || !(await isAdminUser(env, senderId))) return;

  if (text === "/cleanup") {
      ctx.waitUntil(handleCleanupCommand(threadId, env));
      return;
  }

  if (text === "/help" || text === "/admin") {
      let lookupUserId = null;
      if (threadId) {
          const mapped = await env.TOPIC_MAP.get(`thread:${threadId}`);
          if (mapped) lookupUserId = mapped;
      }
      
      const adminHelp = `🛠️ **Sandstorm 管理员专属控制台**\n\n${lookupUserId ? `当前话题对应用户 UID: \`${lookupUserId}\`` : "⚠️ 当前不在特定用户话题内"}\n\n**可用指令列表：**\n- \`/info\`：查看当前话题用户的详细状态（验证、封禁信息）\n- \`/close\`：关闭当前对话（用户会收到关闭提示）\n- \`/open\`：重新开启当前对话\n- \`/ban\`：拉黑当前用户，拒收任何消息\n- \`/unban\`：解除对当前用户的拉黑\n- \`/trust\`：设为永久信任（免去人机验证）\n- \`/reset\`：重置验证状态（强制用户重新验证）\n- \`/cleanup\`：扫描清理全站失效话题（资源回收，全服通用）\n\n💡 *说明：除 cleanup 外，上述命令需在特定用户话题内发送生效。直接回复用户的消息即可完成双向传话。*`;
      await tgCall(env, "sendMessage", withMessageThreadId({
          chat_id: env.SUPERGROUP_ID,
          text: adminHelp,
          parse_mode: "Markdown"
      }, threadId));
      return;
  }

  let userId = null;
  const mappedUser = await env.TOPIC_MAP.get(`thread:${threadId}`);
  if (mappedUser) {
      userId = Number(mappedUser);
  } else {
      const allKeys = await getAllKeys(env, "user:");
      for (const { name } of allKeys) {
          const rec = await safeGetJSON(env, name, null);
          if (rec && Number(rec.thread_id) === Number(threadId)) {
              userId = Number(name.slice(5));
              break;
          }
      }
  }

  if (!userId) return; 

  if (text === "/close") {
      const key = `user:${userId}`;
      let rec = await safeGetJSON(env, key, null);
      if (rec) {
          rec.closed = true;
          await env.TOPIC_MAP.put(key, JSON.stringify(rec));
          await tgCall(env, "closeForumTopic", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId });
          await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "🚫 **对话已强制关闭**", parse_mode: "Markdown" });
      }
      return;
  }

  if (text === "/open") {
      const key = `user:${userId}`;
      let rec = await safeGetJSON(env, key, null);
      if (rec) {
          rec.closed = false;
          await env.TOPIC_MAP.put(key, JSON.stringify(rec));
          await tgCall(env, "reopenForumTopic", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId });
          await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "✅ **对话已恢复**", parse_mode: "Markdown" });
      }
      return;
  }

  if (text === "/reset") {
      await env.TOPIC_MAP.delete(`verified:${userId}`);
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "🔄 **验证重置**", parse_mode: "Markdown" });
      return;
  }

  if (text === "/trust") {
      await env.TOPIC_MAP.put(`verified:${userId}`, "trusted");
      await env.TOPIC_MAP.delete(`needs_verify:${userId}`);
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "🌟 **已设置永久信任**", parse_mode: "Markdown" });
      return;
  }

  if (text === "/ban") {
      await env.TOPIC_MAP.put(`banned:${userId}`, "1");
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "🚫 **用户已封禁**", parse_mode: "Markdown" });
      return;
  }

  if (text === "/unban") {
      await env.TOPIC_MAP.delete(`banned:${userId}`);
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: "✅ **用户已解封**", parse_mode: "Markdown" });
      return;
  }

  if (text === "/info") {
      const userKey = `user:${userId}`;
      const userRec = await safeGetJSON(env, userKey, null);
      const verifyStatus = await env.TOPIC_MAP.get(`verified:${userId}`);
      const banStatus = await env.TOPIC_MAP.get(`banned:${userId}`);

      const info = `👤 **用户信息**\nUID: \`${userId}\`\nTopic ID: \`${threadId}\`\n话题标题: ${userRec?.title || "未知"}\n验证状态: ${verifyStatus ? (verifyStatus === 'trusted' ? '🌟 永久信任' : '✅ 已验证') : '❌ 未验证'}\n封禁状态: ${banStatus ? '🚫 已封禁' : '✅ 正常'}\nLink: [点击私聊](tg://user?id=${userId})`;
      await tgCall(env, "sendMessage", { chat_id: env.SUPERGROUP_ID, message_thread_id: threadId, text: info, parse_mode: "Markdown" });
      return;
  }

  if (msg.media_group_id) {
    await handleMediaGroup(msg, env, ctx, { direction: "t2p", targetChat: userId, threadId: undefined });
    return;
  }
  
  // 普通单条消息回复散客
  const res = await tgCall(env, "copyMessage", { chat_id: userId, from_chat_id: env.SUPERGROUP_ID, message_id: msg.message_id });
  
  // 【新增补齐】管理员发给用户，原消息亮起 🐳 大拇指
  if (res.ok) {
      await sendSuccessReaction(env, env.SUPERGROUP_ID, msg.message_id, "🐳");
  }
}

// ---------------- 验证模块 (纯本地) ----------------

async function sendVerificationChallenge(userId, env, pendingMsgId) {
    const existingChallenge = await env.TOPIC_MAP.get(`user_challenge:${userId}`);
    if (existingChallenge) {
        const chalKey = `chal:${existingChallenge}`;
        const state = await safeGetJSON(env, chalKey, null);

        if (!state || state.userId !== userId) {
            await env.TOPIC_MAP.delete(`user_challenge:${userId}`);
        } else {
            if (pendingMsgId) {
                let pendingIds = Array.isArray(state.pending_ids) ? state.pending_ids.slice() : (state.pending ? [state.pending] : []);
                if (!pendingIds.includes(pendingMsgId)) {
                    pendingIds.push(pendingMsgId);
                    if (pendingIds.length > CONFIG.PENDING_MAX_MESSAGES) pendingIds = pendingIds.slice(pendingIds.length - CONFIG.PENDING_MAX_MESSAGES);
                    state.pending_ids = pendingIds;
                    delete state.pending;
                    await env.TOPIC_MAP.put(chalKey, JSON.stringify(state), { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });
                }
            }
            return;
        }
    }

    const verifyLimit = await checkRateLimit(userId, env, 'verify', CONFIG.RATE_LIMIT_VERIFY, 300);
    if (!verifyLimit.allowed) {
        await tgCall(env, "sendMessage", { chat_id: userId, text: "⚠️ 验证请求过于频繁，请5分钟后再试。" });
        return;
    }

    const q = LOCAL_QUESTIONS[secureRandomInt(0, LOCAL_QUESTIONS.length)];
    const challenge = { question: q.question, correct: q.correct_answer, options: shuffleArray([...q.incorrect_answers, q.correct_answer]) };
    const verifyId = secureRandomId(CONFIG.VERIFY_ID_LENGTH);
    const answerIndex = challenge.options.indexOf(challenge.correct);

    const state = { answerIndex: answerIndex, options: challenge.options, pending_ids: pendingMsgId ? [pendingMsgId] : [], userId: userId };

    await env.TOPIC_MAP.put(`chal:${verifyId}`, JSON.stringify(state), { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });
    await env.TOPIC_MAP.put(`user_challenge:${userId}`, verifyId, { expirationTtl: CONFIG.VERIFY_EXPIRE_SECONDS });

    const buttons = challenge.options.map((opt, idx) => ({ text: opt, callback_data: `verify:${verifyId}:${idx}` }));
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += CONFIG.BUTTON_COLUMNS) keyboard.push(buttons.slice(i, i + CONFIG.BUTTON_COLUMNS));

    await tgCall(env, "sendMessage", {
        chat_id: userId,
        text: `🛡️ **人机验证**\n\n${challenge.question}\n\n请点击下方按钮回答 (回答正确后将自动发送您刚才的消息)。`,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleCallbackQuery(query, env, ctx) {
    try {
        const data = query.data;
        if (!data.startsWith("verify:")) return;

        const parts = data.split(":");
        if (parts.length !== 3) return;

        const verifyId = parts[1];
        const selectedIndex = parseInt(parts[2]);
        const userId = query.from.id;

        const stateStr = await env.TOPIC_MAP.get(`chal:${verifyId}`);
        if (!stateStr) {
            await tgCall(env, "answerCallbackQuery", { callback_query_id: query.id, text: "❌ 验证已过期，请重发消息", show_alert: true });
            return;
        }

        let state;
        try { state = JSON.parse(stateStr); } catch(e) { await tgCall(env, "answerCallbackQuery", { callback_query_id: query.id, text: "❌ 数据错误", show_alert: true }); return; }

        if (state.userId && state.userId !== userId) {
            await tgCall(env, "answerCallbackQuery", { callback_query_id: query.id, text: "❌ 无效的验证", show_alert: true });
            return;
        }

        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.options.length) {
            await tgCall(env, "answerCallbackQuery", { callback_query_id: query.id, text: "❌ 无效选项", show_alert: true });
            return;
        }

        if (selectedIndex === state.answerIndex) {
            await tgCall(env, "answerCallbackQuery", { callback_query_id: query.id, text: "✅ 验证通过" });

            await env.TOPIC_MAP.put(`verified:${userId}`, "1", { expirationTtl: CONFIG.VERIFIED_EXPIRE_SECONDS });
            await env.TOPIC_MAP.delete(`needs_verify:${userId}`);
            await env.TOPIC_MAP.delete(`chal:${verifyId}`);
            await env.TOPIC_MAP.delete(`user_challenge:${userId}`);

            const successText = `✅ **验证成功**\n\n👋 **欢迎使用 Sandstorm 专属传话筒**\n\n您现在可以自由与我对话。我会将您的消息原封不动地转达给管理员。\n\n💡 **使用说明：**\n• 直接发送文本、图片、视频或文件即可。\n• 请文明用语，耐心等待回复。\n• 消息送达后右下角会闪烁 🦄 星光图标提示。`;
            await tgCall(env, "editMessageText", {
                chat_id: userId,
                message_id: query.message.message_id,
                text: successText,
                parse_mode: "Markdown"
            });

            const hasPending = (Array.isArray(state.pending_ids) && state.pending_ids.length > 0) || !!state.pending;
            if (hasPending) {
                try {
                    let pendingIds = Array.isArray(state.pending_ids) ? state.pending_ids.slice() : (state.pending ? [state.pending] : []);
                    if (pendingIds.length > CONFIG.PENDING_MAX_MESSAGES) pendingIds = pendingIds.slice(pendingIds.length - CONFIG.PENDING_MAX_MESSAGES);

                    let forwardedCount = 0;
                    for (const pendingId of pendingIds) {
                        if (!pendingId) continue;
                        const forwardedKey = `forwarded:${userId}:${pendingId}`;
                        const alreadyForwarded = await env.TOPIC_MAP.get(forwardedKey);
                        if (alreadyForwarded) continue;

                        const fakeMsg = { message_id: pendingId, chat: { id: userId, type: "private" }, from: query.from };
                        await forwardToTopic(fakeMsg, userId, `user:${userId}`, env, ctx);
                        await env.TOPIC_MAP.put(forwardedKey, "1", { expirationTtl: 3600 });
                        forwardedCount++;
                    }

                    if (forwardedCount > 0) {
                        await tgCall(env, "sendMessage", { chat_id: userId, text: `📩 刚才暂存的 ${forwardedCount} 条消息已帮您送达。` });
                    }
                } catch (e) {
                    await tgCall(env, "sendMessage", { chat_id: userId, text: "⚠️ 自动发送失败，请重新发送您的消息。" });
                }
            }
        } else {
            await tgCall(env, "answerCallbackQuery", { callback_query_id: query.id, text: "❌ 答案错误", show_alert: true });
        }
    } catch (e) {
        await tgCall(env, "answerCallbackQuery", { callback_query_id: query.id, text: `⚠️ 系统错误，请重试`, show_alert: true });
    }
}

// ---------------- 辅助函数 ----------------

async function handleCleanupCommand(threadId, env) {
    const lockKey = "cleanup:lock";
    const locked = await env.TOPIC_MAP.get(lockKey);
    if (locked) {
        await tgCall(env, "sendMessage", withMessageThreadId({ chat_id: env.SUPERGROUP_ID, text: "⏳ **已有清理任务正在运行，请稍后再试。**", parse_mode: "Markdown" }, threadId));
        return;
    }

    await env.TOPIC_MAP.put(lockKey, "1", { expirationTtl: CONFIG.CLEANUP_LOCK_TTL_SECONDS });
    await tgCall(env, "sendMessage", withMessageThreadId({ chat_id: env.SUPERGROUP_ID, text: "🔄 **正在扫描需要清理的用户...**", parse_mode: "Markdown" }, threadId));

    let cleanedCount = 0, errorCount = 0, scannedCount = 0;
    const cleanedUsers = [];

    try {
        let cursor = undefined;
        do {
            const result = await env.TOPIC_MAP.list({ prefix: "user:", cursor });
            const names = (result.keys || []).map(k => k.name);
            scannedCount += names.length;

            for (let i = 0; i < names.length; i += CONFIG.CLEANUP_BATCH_SIZE) {
                const batch = names.slice(i, i + CONFIG.CLEANUP_BATCH_SIZE);
                const results = await Promise.allSettled(
                    batch.map(async (name) => {
                        const rec = await safeGetJSON(env, name, null);
                        if (!rec || !rec.thread_id) return null;
                        const userId = name.slice(5);
                        const topicThreadId = rec.thread_id;
                        const probe = await probeForumThread(env, topicThreadId, { userId, reason: "cleanup_check", doubleCheckOnMissingThreadId: false });

                        if (probe.status === "redirected" || probe.status === "missing") {
                            await env.TOPIC_MAP.delete(name);
                            await env.TOPIC_MAP.delete(`verified:${userId}`);
                            await env.TOPIC_MAP.delete(`thread:${topicThreadId}`);
                            return { userId, threadId: topicThreadId, title: rec.title || "未知" };
                        }
                        return null;
                })
            );

            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    cleanedCount++;
                    cleanedUsers.push(result.value);
                } else if (result.status === 'rejected') {
                    errorCount++;
                }
            });

                if (i + CONFIG.CLEANUP_BATCH_SIZE < names.length) await new Promise(r => setTimeout(r, 600));
            }

            cursor = result.list_complete ? undefined : result.cursor;
            if (cursor) await new Promise(r => setTimeout(r, 200));
        } while (cursor);

        let reportText = `✅ **清理完成**\n\n📊 **统计信息**\n- 扫描用户数: ${scannedCount}\n- 已清理用户数: ${cleanedCount}\n- 错误数: ${errorCount}\n\n`;
        if (cleanedCount > 0) {
            reportText += `🗑️ **已清理的用户** (话题已删除):\n`;
            for (const user of cleanedUsers.slice(0, CONFIG.MAX_CLEANUP_DISPLAY)) reportText += `- UID: \`${user.userId}\` | 话题: ${user.title}\n`;
            if (cleanedUsers.length > CONFIG.MAX_CLEANUP_DISPLAY) reportText += `\n...(还有 ${cleanedUsers.length - CONFIG.MAX_CLEANUP_DISPLAY} 个用户)\n`;
            reportText += `\n💡 这些用户下次发消息时将重新进行人机验证并创建新话题。`;
        } else {
            reportText += `✨ 没有发现需要清理的用户记录。`;
        }

        await tgCall(env, "sendMessage", withMessageThreadId({ chat_id: env.SUPERGROUP_ID, text: reportText, parse_mode: "Markdown" }, threadId));
    } catch (e) {
        await tgCall(env, "sendMessage", withMessageThreadId({ chat_id: env.SUPERGROUP_ID, text: `❌ **清理过程出错**\n\n错误信息: \`${e.message}\``, parse_mode: "Markdown" }, threadId));
    } finally {
        await env.TOPIC_MAP.delete(lockKey);
    }
}

async function createTopic(from, key, env, userId) {
    const title = buildTopicTitle(from);
    if (!env.SUPERGROUP_ID.toString().startsWith("-100")) throw new Error("SUPERGROUP_ID必须以-100开头");
    const res = await tgCall(env, "createForumTopic", { chat_id: env.SUPERGROUP_ID, name: title });
    if (!res.ok) throw new Error(`创建话题失败: ${res.description}`);
    const rec = { thread_id: res.result.message_thread_id, title, closed: false };
    await env.TOPIC_MAP.put(key, JSON.stringify(rec));
    if (userId) await env.TOPIC_MAP.put(`thread:${rec.thread_id}`, String(userId));
    return rec;
}

async function updateThreadStatus(threadId, isClosed, env) {
    try {
        const mappedUser = await env.TOPIC_MAP.get(`thread:${threadId}`);
        if (mappedUser) {
            const userKey = `user:${mappedUser}`;
            const rec = await safeGetJSON(env, userKey, null);
            if (rec && Number(rec.thread_id) === Number(threadId)) {
                rec.closed = isClosed;
                await env.TOPIC_MAP.put(userKey, JSON.stringify(rec));
                return;
            }
            await env.TOPIC_MAP.delete(`thread:${threadId}`);
        }

        const allKeys = await getAllKeys(env, "user:");
        const updates = [];
        for (const { name } of allKeys) {
            const rec = await safeGetJSON(env, name, null);
            if (rec && Number(rec.thread_id) === Number(threadId)) {
                rec.closed = isClosed;
                updates.push(env.TOPIC_MAP.put(name, JSON.stringify(rec)));
            }
        }
        await Promise.all(updates);
    } catch (e) {
        throw e;
    }
}

function buildTopicTitle(from) {
  const firstName = (from.first_name || "").trim().substring(0, CONFIG.MAX_NAME_LENGTH);
  const lastName = (from.last_name || "").trim().substring(0, CONFIG.MAX_NAME_LENGTH);
  let username = "";
  if (from.username) username = from.username.replace(/[^\w]/g, '').substring(0, 20);
  const cleanName = (firstName + " " + lastName).replace(/[\u0000-\u001F\u007F-\u009F]/g, '').replace(/\s+/g, ' ').trim();
  const name = cleanName || "User";
  const usernameStr = username ? ` @${username}` : "";
  return (name + usernameStr).substring(0, CONFIG.MAX_TITLE_LENGTH);
}

async function tgCall(env, method, body, timeout = CONFIG.API_TIMEOUT_MS) {
  let base = env.API_BASE || "https://api.telegram.org";
  if (base.startsWith("http://")) base = base.replace("http://", "https://");
  
  try { new URL(`${base}/test`); } catch (e) { base = "https://api.telegram.org"; }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
      const resp = await fetch(`${base}/bot${env.BOT_TOKEN}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
      });
      clearTimeout(timeoutId);
      const result = await resp.json();
      return result;
  } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') return { ok: false, description: 'Request timeout' };
      throw e;
  }
}

async function handleMediaGroup(msg, env, ctx, { direction, targetChat, threadId }) {
    const groupId = msg.media_group_id;
    const key = `mg:${direction}:${groupId}`;
    const item = extractMedia(msg);
    if (!item) {
        const res = await tgCall(env, "copyMessage", withMessageThreadId({ chat_id: targetChat, from_chat_id: msg.chat.id, message_id: msg.message_id }, threadId));
        if (res.ok) {
            // 【新增补齐】区分单向反馈的表情
            await sendSuccessReaction(env, msg.chat.id, msg.message_id, direction === "p2t" ? "🦄" : "👍");
        }
        return;
    }
    let rec = await safeGetJSON(env, key, null);
    if (!rec) rec = { direction, targetChat, sourceChatId: msg.chat.id, threadId: (threadId === null ? undefined : threadId), items: [], last_ts: Date.now() };
    
    rec.items.push({ ...item, msg_id: msg.message_id });
    rec.last_ts = Date.now();
    await env.TOPIC_MAP.put(key, JSON.stringify(rec), { expirationTtl: CONFIG.MEDIA_GROUP_EXPIRE_SECONDS });
    ctx.waitUntil(delaySend(env, key, rec.last_ts));
}

function extractMedia(msg) {
    if (msg.photo && msg.photo.length > 0) return { type: "photo", id: msg.photo[msg.photo.length - 1].file_id, cap: msg.caption || "" };
    if (msg.video) return { type: "video", id: msg.video.file_id, cap: msg.caption || "" };
    if (msg.document) return { type: "document", id: msg.document.file_id, cap: msg.caption || "" };
    if (msg.audio) return { type: "audio", id: msg.audio.file_id, cap: msg.caption || "" };
    if (msg.animation) return { type: "animation", id: msg.animation.file_id, cap: msg.caption || "" };
    return null;
}

async function flushExpiredMediaGroups(env, now) {
    try {
        const allKeys = await getAllKeys(env, "mg:");
        for (const { name } of allKeys) {
            const rec = await safeGetJSON(env, name, null);
            if (rec && rec.last_ts && (now - rec.last_ts > 300000)) await env.TOPIC_MAP.delete(name);
        }
    } catch (e) {}
}

async function delaySend(env, key, ts) {
    await new Promise(r => setTimeout(r, CONFIG.MEDIA_GROUP_DELAY_MS));
    const rec = await safeGetJSON(env, key, null);

    if (rec && rec.last_ts === ts) {
        if (!rec.items || rec.items.length === 0) {
            await env.TOPIC_MAP.delete(key);
            return;
        }

        const media = rec.items.map((it, i) => {
            if (!it.type || !it.id) return null;
            return { type: it.type, media: it.id, caption: i === 0 ? (it.cap || "").substring(0, 1024) : "" };
        }).filter(Boolean);

        if (media.length > 0) {
            try {
                const result = await tgCall(env, "sendMediaGroup", withMessageThreadId({ chat_id: rec.targetChat, media }, rec.threadId));
                if (result.ok && rec.items.length > 0) {
                    // 【新增补齐】为相册提供回执，同样区分正反向
                    await sendSuccessReaction(env, rec.sourceChatId, rec.items[0].msg_id, rec.direction === "p2t" ? "🦄" : "👍");
                }
            } catch (e) {}
        }
        await env.TOPIC_MAP.delete(key);
    }
}
