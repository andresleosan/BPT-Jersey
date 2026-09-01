import {
  createOfflineAttendanceQueue,
  type OfflineAttendanceQueue,
} from "@bpt-jersey/domain/attendance/offline-queue";

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export function createBrowserOfflineAttendanceQueue(input: {
  academyId: string;
  deviceId: string;
  storage: BrowserStorage;
}): OfflineAttendanceQueue {
  return createOfflineAttendanceQueue({
    academyId: input.academyId,
    deviceId: input.deviceId,
    storage: {
      read: (key) => {
        const value = input.storage.getItem(key);
        return value === null ? undefined : JSON.parse(value);
      },
      write: (key, events) => {
        input.storage.setItem(key, JSON.stringify(events));
      },
    },
  });
}
