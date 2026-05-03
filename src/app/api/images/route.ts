import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { esxiClient } from '@/lib/infrastructure';

/**
 * GET /api/images
 *
 * ?source=datastore  → CLOUD_IMAGE_DATASTORE / CLOUD_IMAGE_PATH 의 OVA/OVF 목록
 * ?source=library    → Content Library 이미지 목록 (기존)
 * 기본값: datastore
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const source = request.nextUrl.searchParams.get('source') ?? 'datastore';

  try {
    if (source === 'library') {
      const images = await esxiClient.listCloudImages('/');
      return NextResponse.json({ success: true, source: 'library', data: images });
    }

    // datastore (기본)
    const images = await esxiClient.listDatastoreImages();
    return NextResponse.json({ success: true, source: 'datastore', data: images });
  } catch (error: any) {
    console.error('[API] GET /api/images error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch images' },
      { status: 500 }
    );
  }
}
