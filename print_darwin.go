package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework PDFKit

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <PDFKit/PDFKit.h>
#import <objc/runtime.h>

static const char siDelegateKey = 0;
static const char siWinKey = 0;

@interface SIPrintDelegate : NSObject <WKNavigationDelegate>
@property (strong) WKWebView *webView;
@end

@implementation SIPrintDelegate

static void siCleanupWindow(WKWebView *webView) {
    NSWindow *hw = objc_getAssociatedObject(webView, &siWinKey);
    if (!hw) return;
    NSWindow *parent = hw.parentWindow;
    if (parent) [parent removeChildWindow:hw];
    [hw close];
}

static void siRunPrintOp(NSPrintOperation *op) {
    if (!op) return;
    NSWindow *mainWin = [NSApp mainWindow];
    if (!mainWin) mainWin = [NSApp.windows firstObject];
    if (mainWin) {
        [op runOperationModalForWindow:mainWin delegate:nil didRunSelector:nil contextInfo:nil];
    } else {
        [op runOperation];
    }
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (@available(macOS 11.0, *)) {
            WKPDFConfiguration *pdfConfig = [[WKPDFConfiguration alloc] init];
            [webView createPDFWithConfiguration:pdfConfig completionHandler:^(NSData *pdfData, NSError *error) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (!error && pdfData) {
                        PDFDocument *doc = [[PDFDocument alloc] initWithData:pdfData];
                        if (doc) {
                            NSPrintOperation *op = [doc printOperationForPrintInfo:[NSPrintInfo sharedPrintInfo]
                                                                       scalingMode:kPDFPrintPageScaleDownToFit
                                                                        autoRotate:YES];
                            siRunPrintOp(op);
                            siCleanupWindow(webView);
                            return;
                        }
                    }
                    // fallback
                    NSPrintOperation *op = [webView printOperationWithPrintInfo:[NSPrintInfo sharedPrintInfo]];
                    siRunPrintOp(op);
                    siCleanupWindow(webView);
                });
            }];
        } else {
            NSPrintOperation *op = [webView printOperationWithPrintInfo:[NSPrintInfo sharedPrintInfo]];
            siRunPrintOp(op);
            siCleanupWindow(webView);
        }
    });
}

@end

void siPrintHTML(const char* html) {
    // Convert to NSString BEFORE dispatch_async.
    // Go's defer C.free() runs when PrintHTML() returns, which is before the
    // async block executes — so the raw char* would be dangling inside the block.
    NSString *htmlStr = [NSString stringWithUTF8String:html];

    dispatch_async(dispatch_get_main_queue(), ^{
        SIPrintDelegate *delegate = [[SIPrintDelegate alloc] init];

        NSWindow *mainWin = [NSApp mainWindow];
        if (!mainWin) mainWin = [NSApp.windows firstObject];

        // On-screen child window placed BEHIND the main window.
        // WKWebView requires a real on-screen window to get a GPU rendering context.
        NSRect mf = mainWin ? mainWin.frame : NSMakeRect(100, 100, 595, 842);
        NSWindow *pw = [[NSWindow alloc]
            initWithContentRect:NSMakeRect(mf.origin.x, mf.origin.y, 595, 842)
            styleMask:NSWindowStyleMaskBorderless
            backing:NSBackingStoreBuffered
            defer:NO];
        pw.releasedWhenClosed = NO;
        pw.ignoresMouseEvents = YES;
        pw.hasShadow = NO;
        pw.backgroundColor = [NSColor clearColor];
        pw.opaque = NO;
        pw.alphaValue = 0.01;

        WKWebView *wv = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 595, 842)];
        wv.navigationDelegate = delegate;
        delegate.webView = wv;
        [pw.contentView addSubview:wv];

        if (mainWin) {
            [mainWin addChildWindow:pw ordered:NSWindowBelow];
        } else {
            [pw orderFront:nil];
        }

        [wv loadHTMLString:htmlStr baseURL:[NSURL URLWithString:@"about:blank"]];

        objc_setAssociatedObject(wv, &siDelegateKey, delegate, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        objc_setAssociatedObject(wv, &siWinKey, pw, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    });
}
void siPrintText(const char* text) {
    NSString *textStr = [NSString stringWithUTF8String:text];
    dispatch_async(dispatch_get_main_queue(), ^{
        NSMutableAttributedString *attrStr = [[NSMutableAttributedString alloc] initWithString:textStr];
        NSFont *font = [NSFont fontWithName:@"Menlo" size:11.0];
        if (!font) font = [NSFont userFixedPitchFontOfSize:11.0];
        [attrStr addAttribute:NSFontAttributeName value:font range:NSMakeRange(0, attrStr.length)];

        NSPrintInfo *pi = [[NSPrintInfo sharedPrintInfo] copy];
        CGFloat margin = 36.0;
        pi.leftMargin   = margin;
        pi.rightMargin  = margin;
        pi.topMargin    = margin;
        pi.bottomMargin = margin;

        CGFloat w = pi.paperSize.width  - pi.leftMargin - pi.rightMargin;
        CGFloat h = pi.paperSize.height - pi.topMargin  - pi.bottomMargin;

        NSTextView *tv = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
        tv.editable = NO;
        [tv.textStorage setAttributedString:attrStr];
        [tv sizeToFit];

        NSPrintOperation *op = [NSPrintOperation printOperationWithView:tv printInfo:pi];
        op.showsPrintPanel    = YES;
        op.showsProgressPanel = YES;

        NSWindow *win = [NSApp mainWindow];
        if (!win) win = [NSApp.windows firstObject];
        if (win) {
            [op runOperationModalForWindow:win delegate:nil didRunSelector:nil contextInfo:nil];
        } else {
            [op runOperation];
        }
    });
}
*/
import "C"
import "unsafe"

func (a *App) PrintHTML(html string) {
	cs := C.CString(html)
	defer C.free(unsafe.Pointer(cs))
	C.siPrintHTML(cs)
}

func (a *App) PrintText(text string) {
	cs := C.CString(text)
	defer C.free(unsafe.Pointer(cs))
	C.siPrintText(cs)
}
