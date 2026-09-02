import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import type { Stats } from "fs";
import {
  directoryPermissionMessage,
  type BrowsableDirectory,
  getBrowseStartDirectory,
  getParentDirectory,
  isPermissionError,
  listDirectories,
  listWindowsDrives,
  resolveDirectory,
  shouldShowWindowsDrivePicker,
} from "@/lib/directory-browser";

// GET /api/cwd/browse?path=...：列出文件系统中的可读子目录。
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("path")?.trim();

    if (shouldShowWindowsDrivePicker(requested)) {
      return NextResponse.json({
        path: "",
        parentPath: null,
        drives: await listWindowsDrives(),
        directories: [],
      });
    }

    const candidate = getBrowseStartDirectory(requested);

    let resolved: string;
    try {
      resolved = await resolveDirectory(candidate);
    } catch (error) {
      if (isPermissionError(error)) {
        return NextResponse.json({ error: directoryPermissionMessage(candidate) }, { status: 403 });
      }
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }

    let directoryStat: Stats;
    try {
      directoryStat = await stat(resolved);
    } catch (error) {
      if (isPermissionError(error)) {
        return NextResponse.json({ error: directoryPermissionMessage(resolved) }, { status: 403 });
      }
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }
    if (!directoryStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    let directories: BrowsableDirectory[];
    try {
      directories = await listDirectories(resolved);
    } catch (error) {
      if (isPermissionError(error)) {
        return NextResponse.json({ error: directoryPermissionMessage(resolved) }, { status: 403 });
      }
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }

    return NextResponse.json({
      path: resolved,
      parentPath: getParentDirectory(resolved),
      directories,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
