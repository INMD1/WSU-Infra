import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { esxiClient } from '@/lib/infrastructure';

/**
 * GET /api/images
 *
 * ?source=library    → Content Library 이미지 목록 (CONTENT_LIBRARY_PATH 사용, 기본값)
 * ?source=datastore  → CLOUD_IMAGE_DATASTORE / CLOUD_IMAGE_PATH 의 OVA/OVF 목록 (디버그용)
 * ?include=all       → ISO 등 비배포 항목도 포함 (기본은 OVA/OVF 만)
 * 기본값: source=library
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const source = request.nextUrl.searchParams.get('source') ?? 'library';
  const includeAll = request.nextUrl.searchParams.get('include') === 'all';

  try {
    if (source === 'datastore') {
      const images = await esxiClient.listDatastoreImages();
      return NextResponse.json({ success: true, source: 'datastore', data: images });
    }

    // library (기본). 기본은 VM 배포 가능한 OVA/OVF 만; include=all 이면 ISO 등 모두 포함
    const images = await esxiClient.listCloudImages();
    const data = includeAll
      ? images
      : images.filter(img => img.type === 'ova' || img.type === 'ovf');
    return NextResponse.json({ success: true, source: 'library', data });
  } catch (error: any) {
    console.error('[API] GET /api/images error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch images' },
      { status: 500 }
    );
  }
}
