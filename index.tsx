/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu, RestAPI, Toasts, UserStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");

interface ChannelContextProps {
    channel: {
        id: string;
        type: number;
        guild_id?: string;
    };
}

let isClearing = false;
let shouldStop = false;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function clearMessages(channelId: string) {
    if (isClearing) {
        shouldStop = true;
        Toasts.show({
            message: "Silme işlemi durduruluyor...",
            type: Toasts.Type.MESSAGE,
            id: Toasts.genId()
        });
        return;
    }

    isClearing = true;
    shouldStop = false;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) {
        isClearing = false;
        return;
    }

    Toasts.show({
        message: "Mesajlar siliniyor... (Durdurmak için tekrar tıkla)",
        type: Toasts.Type.MESSAGE,
        id: Toasts.genId()
    });

    let deletedCount = 0;
    let lastMessageId: string | undefined;

    try {
        while (!shouldStop) {
            // Mesajları çek
            const url = lastMessageId
                ? `/channels/${channelId}/messages?limit=100&before=${lastMessageId}`
                : `/channels/${channelId}/messages?limit=100`;

            const response = await RestAPI.get({ url });
            const messages = response.body;

            if (!messages || messages.length === 0) break;

            // Sadece kendi mesajlarımızı filtrele
            const myMessages = messages.filter((m: any) => m.author.id === currentUser.id);

            if (myMessages.length === 0 && messages.length > 0) {
                // Kendi mesajımız yok ama başka mesajlar var, devam et
                lastMessageId = messages[messages.length - 1].id;
                continue;
            }

            if (myMessages.length === 0) break;

            // Mesajları sil
            for (const msg of myMessages) {
                if (shouldStop) break;

                try {
                    await RestAPI.del({ url: `/channels/${channelId}/messages/${msg.id}` });
                    deletedCount++;

                    if (deletedCount % 10 === 0) {
                        Toasts.show({
                            message: `${deletedCount} mesaj silindi...`,
                            type: Toasts.Type.MESSAGE,
                            id: Toasts.genId()
                        });
                    }

                    // Rate limit için bekle
                    await sleep(1100);
                } catch (e: any) {
                    if (e?.status === 429) {
                        // Rate limited, bekle
                        const retryAfter = e?.body?.retry_after || 5;
                        await sleep(retryAfter * 1000 + 500);
                    }
                }
            }

            lastMessageId = messages[messages.length - 1].id;
        }

        Toasts.show({
            message: `Tamamlandı! ${deletedCount} mesaj silindi.`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });
    } catch (e) {
        console.error("[ClearDM] Hata:", e);
        Toasts.show({
            message: "Bir hata oluştu!",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId()
        });
    }

    isClearing = false;
    shouldStop = false;
}

const ChannelContext: NavContextMenuPatchCallback = (children, { channel }: ChannelContextProps) => {
    if (!channel) return;

    // Sadece DM'lerde göster (type 1 = DM, type 3 = Group DM)
    if (channel.type !== 1 && channel.type !== 3) return;

    children.push(
        <Menu.MenuItem
            id="clear-dm"
            label={isClearing ? "Silmeyi Durdur" : "Tüm Mesajlarımı Sil"}
            color="danger"
            action={() => clearMessages(channel.id)}
        />
    );
};

export default definePlugin({
    name: "ClearDM",
    description: "DM'deki tüm mesajlarını sil",
    authors: [{ name: "verfired", id: 1362177941882142923n }],

    contextMenus: {
        "channel-context": ChannelContext,
        "user-context": ChannelContext,
        "gdm-context": ChannelContext
    }
});
