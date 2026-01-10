/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, Menu, RestAPI, Toasts, UserStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");

interface ChannelContextProps {
    channel: {
        id: string;
        type: number;
        guild_id?: string;
    };
}

interface QueueItem {
    channelId: string;
    channelName: string;
}

// Kuyruk sistemi
const queue: QueueItem[] = [];
let isClearing = false;
let shouldStop = false;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getChannelName(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "Bilinmeyen";

    if (channel.type === 1) {
        // DM - kullanıcı adını al
        const recipient = channel.recipients?.[0];
        if (recipient) {
            const user = UserStore.getUser(recipient);
            return user?.username || "DM";
        }
        return "DM";
    }

    return channel.name || "Grup DM";
}

async function processQueue() {
    if (isClearing || queue.length === 0) return;

    isClearing = true;

    while (queue.length > 0 && !shouldStop) {
        const item = queue[0];

        Toasts.show({
            message: `[${queue.length} sırada] ${item.channelName} siliniyor...`,
            type: Toasts.Type.MESSAGE,
            id: Toasts.genId()
        });

        await clearMessages(item.channelId, item.channelName);

        queue.shift(); // İlk elemanı kaldır
    }

    isClearing = false;
    shouldStop = false;

    if (queue.length === 0) {
        Toasts.show({
            message: "Tüm sıra tamamlandı!",
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });
    }
}

async function clearMessages(channelId: string, channelName: string): Promise<void> {
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;

    let deletedCount = 0;
    let lastMessageId: string | undefined;
    const baseDelay = 300;
    let delay = baseDelay;

    try {
        while (!shouldStop) {
            const url = lastMessageId
                ? `/channels/${channelId}/messages?limit=100&before=${lastMessageId}`
                : `/channels/${channelId}/messages?limit=100`;

            let response;
            try {
                response = await RestAPI.get({ url });
            } catch (e: any) {
                if (e?.status === 429) {
                    const retryAfter = e?.body?.retry_after || 2;
                    await sleep(retryAfter * 1000 + 300);
                    continue;
                }
                console.error("[ClearDM] Fetch hatası:", e);
                await sleep(2000);
                continue;
            }

            const messages = response.body;

            if (!messages || messages.length === 0) {
                break;
            }

            const myMessages = messages.filter((m: any) => m.author.id === currentUser.id);

            if (myMessages.length === 0) {
                lastMessageId = messages[messages.length - 1].id;
                await sleep(200);
                continue;
            }

            for (const msg of myMessages) {
                if (shouldStop) break;

                let success = false;
                let retries = 0;

                while (!success && retries < 3) {
                    try {
                        await RestAPI.del({ url: `/channels/${channelId}/messages/${msg.id}` });
                        deletedCount++;
                        success = true;
                        
                        delay = baseDelay;

                        if (deletedCount % 10 === 0) {
                            Toasts.show({
                                message: `${channelName}: ${deletedCount} mesaj silindi...`,
                                type: Toasts.Type.MESSAGE,
                                id: Toasts.genId()
                            });
                        }

                        await sleep(delay);

                    } catch (e: any) {
                        if (e?.status === 429) {
                            const retryAfter = e?.body?.retry_after || 2;
                            await sleep(retryAfter * 1000 + 300);
                            retries++;
                        } else if (e?.status === 404) {
                            success = true;
                            delay = baseDelay;
                        } else {
                            console.error(`[ClearDM] Mesaj silme hatası ${msg.id}:`, e);
                            retries++;
                            await sleep(800);
                        }
                    }
                }
            }

            lastMessageId = messages[messages.length - 1].id;
            await sleep(100);
        }

        Toasts.show({
            message: `${channelName}: Toplam ${deletedCount} mesaj silindi!`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });
    } catch (e) {
        console.error("[ClearDM] Kritik hata:", e);
        Toasts.show({
            message: `${channelName}: Hata oluştu! ${deletedCount} mesaj silindi. Konsolu kontrol et.`,
            type: Toasts.Type.FAILURE,
            id: Toasts.genId()
        });
    }
}

function addToQueue(channelId: string) {
    // Zaten sırada mı kontrol et
    if (queue.some(item => item.channelId === channelId)) {
        Toasts.show({
            message: "Bu kanal zaten sırada!",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId()
        });
        return;
    }

    const channelName = getChannelName(channelId);
    queue.push({ channelId, channelName });

    Toasts.show({
        message: `${channelName} sıraya eklendi! (Sıra: ${queue.length})`,
        type: Toasts.Type.SUCCESS,
        id: Toasts.genId()
    });

    // Eğer işlem çalışmıyorsa başlat
    if (!isClearing) {
        processQueue();
    }
}

function stopAll() {
    shouldStop = true;
    queue.length = 0; // Sırayı temizle

    Toasts.show({
        message: "Tüm işlemler durduruluyor...",
        type: Toasts.Type.MESSAGE,
        id: Toasts.genId()
    });
}

const ChannelContext: NavContextMenuPatchCallback = (children, { channel }: ChannelContextProps) => {
    if (!channel) return;

    // Sadece DM'lerde göster (type 1 = DM, type 3 = Group DM)
    if (channel.type !== 1 && channel.type !== 3) return;

    const isInQueue = queue.some(item => item.channelId === channel.id);

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="clear-dm-add"
                label={isInQueue ? "Zaten Sırada" : "Sıraya Ekle"}
                color="danger"
                disabled={isInQueue}
                action={() => addToQueue(channel.id)}
            />
            {(isClearing || queue.length > 0) && (
                <Menu.MenuItem
                    id="clear-dm-stop"
                    label={`Tümünü Durdur (${queue.length} sırada)`}
                    color="danger"
                    action={() => stopAll()}
                />
            )}
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "ClearDM",
    description: "DM'deki tüm mesajlarını sil (sıralama sistemi ile)",
    authors: [{ name: "verfired", id: 1362177941882142923n }],

    contextMenus: {
        "channel-context": ChannelContext,
        "user-context": ChannelContext,
        "gdm-context": ChannelContext
    }
});
