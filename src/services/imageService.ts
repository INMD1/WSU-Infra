import { esxiClient } from '../lib/infrastructure';

/**
 * 클라우드 이미지 (OVA/OVF) 관리 서비스
 */
export const imageService = {
  /**
   * Content Library 목록 조회
   */
  async listLibraries() {
    return await esxiClient.listContentLibraries();
  },

  /**
   * Cloud Image (OVA/OVF) 목록 조회
   * @param libraryPath - Library 경로 (기본: "/")
   */
  async listImages(libraryPath = '/') {
    return await esxiClient.listCloudImages(libraryPath);
  },

  /**
   * 특정 Library 의 이미지 목록 조회
   */
  async getImagesByLibrary(libraryName: string) {
    const libraries = await this.listLibraries();
    const library = libraries.find(lib => lib.name === libraryName);

    if (!library) {
      throw new Error(`Library not found: ${libraryName}`);
    }

    // Library 경로 추출 (간단한 구현 - 실제는 더 복잡할 수 있음)
    const libraryPath = `/${libraryName}`;
    return await this.listImages(libraryPath);
  },

  /**
   * 이미지 상세 정보 조회
   */
  async getImageDetails(imageName: string, libraryPath = '/') {
    const images = await this.listImages(libraryPath);
    const image = images.find(img => img.name === imageName);

    if (!image) {
      throw new Error(`Image not found: ${imageName}`);
    }

    return image;
  },

  /**
   * 이미지 타입 감지 (OVA, OVF, Appliance)
   */
  detectImageType(name: string) {
    return esxiClient.detectImageType(name);
  }
};
