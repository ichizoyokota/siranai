package main

// #cgo CFLAGS: -x objective-c
// #cgo LDFLAGS: -framework Foundation
// #import <Foundation/Foundation.h>
// #include <string.h>
//
// // Returns a malloc'd copy — caller must free() it.
// char* osDisplayNameForPath(const char* path) {
//     @autoreleasepool {
//         NSString *nsPath = [NSString stringWithUTF8String:path];
//         NSString *name = [[NSFileManager defaultManager] displayNameAtPath:nsPath];
//         return strdup([name UTF8String]);
//     }
// }
import "C"
import (
	"path/filepath"
	"unsafe"
)

// GetDisplayName returns the OS-localized display string for the given file path,
// e.g. "デスクトップ / file.md" when the system language is Japanese.
func (a *App) GetDisplayName(path string) string {
	if path == "" {
		return ""
	}

	dir := filepath.Dir(path)

	cDir := C.CString(dir)
	defer C.free(unsafe.Pointer(cDir))
	cDirName := C.osDisplayNameForPath(cDir)
	defer C.free(unsafe.Pointer(cDirName))
	dirName := C.GoString(cDirName)

	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	cFileName := C.osDisplayNameForPath(cPath)
	defer C.free(unsafe.Pointer(cFileName))
	fileName := C.GoString(cFileName)

	if dirName == "" || dirName == "." {
		return fileName
	}
	return dirName + " / " + fileName
}
