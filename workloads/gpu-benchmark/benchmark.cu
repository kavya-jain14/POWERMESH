#include <cuda_runtime.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>

namespace {

constexpr int kTile = 16;

void check(cudaError_t status, const char* operation) {
  if (status == cudaSuccess) return;
  std::cerr << "CUDA_ERROR:" << operation << ":" << cudaGetErrorString(status) << "\n";
  std::exit(1);
}

int integerParam(const std::string& json, const std::string& key) {
  const std::string marker = "\"" + key + "\":";
  const std::size_t start = json.find(marker);
  if (start == std::string::npos) return -1;
  const char* value = json.c_str() + start + marker.size();
  char* end = nullptr;
  const long parsed = std::strtol(value, &end, 10);
  return end == value ? -1 : static_cast<int>(parsed);
}

std::string jsonString(const char* input) {
  std::string output;
  for (const unsigned char character : std::string(input)) {
    if (character == '\\' || character == '"') output.push_back('\\');
    if (character >= 32) output.push_back(static_cast<char>(character));
  }
  return output;
}

uint64_t fnv1a(const std::string& value) {
  uint64_t hash = 1469598103934665603ULL;
  for (const unsigned char byte : value) {
    hash ^= byte;
    hash *= 1099511628211ULL;
  }
  return hash;
}

__global__ void fill(float* data, int count, float value) {
  const int index = blockIdx.x * blockDim.x + threadIdx.x;
  if (index < count) data[index] = value;
}

__global__ void matrixMultiply(const float* left, const float* right, float* output, int size) {
  __shared__ float leftTile[kTile][kTile];
  __shared__ float rightTile[kTile][kTile];

  const int row = blockIdx.y * kTile + threadIdx.y;
  const int column = blockIdx.x * kTile + threadIdx.x;
  float sum = 0.0F;

  for (int tile = 0; tile < (size + kTile - 1) / kTile; ++tile) {
    const int leftColumn = tile * kTile + threadIdx.x;
    const int rightRow = tile * kTile + threadIdx.y;
    leftTile[threadIdx.y][threadIdx.x] =
        row < size && leftColumn < size ? left[row * size + leftColumn] : 0.0F;
    rightTile[threadIdx.y][threadIdx.x] =
        rightRow < size && column < size ? right[rightRow * size + column] : 0.0F;
    __syncthreads();
    for (int inner = 0; inner < kTile; ++inner) {
      sum += leftTile[threadIdx.y][inner] * rightTile[inner][threadIdx.x];
    }
    __syncthreads();
  }

  if (row < size && column < size) output[row * size + column] = sum;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "INVALID_PARAMETERS\n";
    return 1;
  }

  const std::string params(argv[1]);
  const int matrixSize = integerParam(params, "matrixSize");
  const int iterations = integerParam(params, "iterations");
  if (matrixSize < 256 || matrixSize > 4096 || matrixSize % 256 != 0 || iterations < 1 ||
      iterations > 100) {
    std::cerr << "INVALID_PARAMETERS\n";
    return 1;
  }

  int deviceCount = 0;
  check(cudaGetDeviceCount(&deviceCount), "device-count");
  if (deviceCount < 1) {
    std::cerr << "NO_CUDA_DEVICE\n";
    return 1;
  }

  cudaDeviceProp properties{};
  check(cudaGetDeviceProperties(&properties, 0), "device-properties");
  int runtimeVersion = 0;
  check(cudaRuntimeGetVersion(&runtimeVersion), "runtime-version");

  const std::size_t elementCount =
      static_cast<std::size_t>(matrixSize) * static_cast<std::size_t>(matrixSize);
  const std::size_t bytes = elementCount * sizeof(float);
  float* left = nullptr;
  float* right = nullptr;
  float* output = nullptr;
  check(cudaMalloc(reinterpret_cast<void**>(&left), bytes), "allocate-left");
  check(cudaMalloc(reinterpret_cast<void**>(&right), bytes), "allocate-right");
  check(cudaMalloc(reinterpret_cast<void**>(&output), bytes), "allocate-output");

  const int fillBlock = 256;
  const int fillGrid = static_cast<int>((elementCount + fillBlock - 1) / fillBlock);
  fill<<<fillGrid, fillBlock>>>(left, static_cast<int>(elementCount), 1.0F);
  fill<<<fillGrid, fillBlock>>>(right, static_cast<int>(elementCount), 2.0F);
  check(cudaGetLastError(), "initialize-matrices");

  cudaEvent_t started{};
  cudaEvent_t finished{};
  check(cudaEventCreate(&started), "create-start-event");
  check(cudaEventCreate(&finished), "create-finish-event");
  const dim3 threads(kTile, kTile);
  const dim3 blocks((matrixSize + kTile - 1) / kTile, (matrixSize + kTile - 1) / kTile);

  check(cudaEventRecord(started), "record-start");
  for (int iteration = 0; iteration < iterations; ++iteration) {
    matrixMultiply<<<blocks, threads>>>(left, right, output, matrixSize);
  }
  check(cudaGetLastError(), "matrix-multiply");
  check(cudaEventRecord(finished), "record-finish");
  check(cudaEventSynchronize(finished), "synchronize");

  float durationMs = 0.0F;
  check(cudaEventElapsedTime(&durationMs, started, finished), "elapsed-time");
  float samples[2]{};
  check(cudaMemcpy(&samples[0], output, sizeof(float), cudaMemcpyDeviceToHost), "copy-first");
  check(cudaMemcpy(
            &samples[1], output + elementCount - 1, sizeof(float), cudaMemcpyDeviceToHost),
        "copy-last");
  const float expected = static_cast<float>(matrixSize) * 2.0F;
  if (std::fabs(samples[0] - expected) > 0.5F || std::fabs(samples[1] - expected) > 0.5F) {
    std::cerr << "RESULT_VALIDATION_FAILED\n";
    return 1;
  }

  std::ostringstream proof;
  proof << properties.name << ':' << matrixSize << ':' << iterations << ':' << std::fixed
        << std::setprecision(1) << samples[0] << ':' << samples[1];
  std::ostringstream checksum;
  checksum << std::hex << std::setfill('0') << std::setw(16) << fnv1a(proof.str());

  std::cout << "{\"type\":\"gpu-benchmark\",\"gpuName\":\""
            << jsonString(properties.name) << "\",\"cudaRuntime\":\""
            << runtimeVersion / 1000 << '.' << (runtimeVersion % 1000) / 10
            << "\",\"computeCapability\":\"" << properties.major << '.' << properties.minor
            << "\",\"memoryMb\":" << properties.totalGlobalMem / (1024 * 1024)
            << ",\"matrixSize\":" << matrixSize << ",\"iterations\":" << iterations
            << ",\"durationMs\":" << std::fixed << std::setprecision(3) << durationMs
            << ",\"checksum\":\"" << checksum.str() << "\"}";

  cudaEventDestroy(started);
  cudaEventDestroy(finished);
  cudaFree(left);
  cudaFree(right);
  cudaFree(output);
  return 0;
}
