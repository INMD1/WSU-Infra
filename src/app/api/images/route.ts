import { NextRequest, NextResponse } from 'next/server';
import { imageService } from '@/services/imageService';

/**
 * GET /api/images
 * Cloud Image (OVA/OVF) 목록 조회
 * Query Parameters:
 *   - library: Library 이름 (선택)
 *   - path: Library 경로 (선택, 기본: "/")
 *   - libraries: true 로 설정 시 Library 목록 조회
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const library = searchParams.get('library');
    const path = searchParams.get('path') || '/';
    const libraries = searchParams.get('libraries');

    // Library 목록 조회 모드
    if (libraries === 'true') {
      const libs = await imageService.listLibraries();
      return NextResponse.json({
        success: true,
        data: libs,
        type: 'libraries'
      });
    }

    // Image 목록 조회
    let images;
    if (library) {
      images = await imageService.getImagesByLibrary(library);
    } else {
      images = await imageService.listImages(path);
    }

    return NextResponse.json({
      success: true,
      data: images,
      count: images.length,
      type: 'images'
    });
  } catch (error: any) {
    console.error('[API] GET /api/images error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch images'
      },
      { status: 500 }
    );
  }
}
